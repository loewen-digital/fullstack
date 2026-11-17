import { BillingError, BillingPurchaseError, BillingWebhookError } from '../errors.js'
import type {
  BillingDriver,
  DriverWebhookResult,
  GooglePlayDriverConfig,
  ProviderEvent,
} from '../types.js'
import {
  GoogleTokenError,
  createGoogleAccess,
  createGooglePushCheck,
  fromBase64,
  messageOfError,
  privateKeyOf,
} from './google-play-auth.js'

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
/** Google Play's page where a customer changes or cancels a subscription */
const MANAGE_URL = 'https://play.google.com/store/account/subscriptions'
const DEFAULT_TIMEOUT_MS = 15_000
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** A purchase token: visible ASCII, as Google hands it to the device */
const PURCHASE_TOKEN = /^[\x21-\x7e]{1,2048}$/
/** The order of a renewal carries the number of the renewal behind two dots */
const RENEWAL_ORDER = /\.\.\d+$/

/** What Google tells about a subscription in a notification, by `notificationType` */
const RESTARTED = 7
const DEFERRED = 9
const REVOKED = 12

type Fields = Record<string, unknown>
/** Refuses what was handed in, in the way of the path it came on: a proof or a delivery */
type Refuse = (message: string) => never

/** What a purchase says once it is read, and what Google waits for once that is applied */
interface Reading {
  /** The product id Google sold */
  productId: string
  events: ProviderEvent[]
  settle?: () => Promise<void>
}

/** What a notification adds to the state of a subscription */
interface Hint {
  /** `notificationType` of a subscription notification */
  type?: number
  /** When Google says the change happened, in milliseconds */
  at?: number
  /** The order a voided purchase notification is about */
  voidedOrder?: string
}

/**
 * Google Play Billing behind the billing module, for a web app shipped as an Android app. The
 * purchase is made on the device, in a Trusted Web Activity through the Digital Goods API; the
 * driver asks Google what the purchase token stands for. Web Crypto and `fetch` only, so it
 * runs on Node and on Cloudflare Workers.
 *
 * - A purchase is `{ itemId, purchaseToken }` as the device got it. The driver reads the
 *   purchase with Google's API as a service account, and what Google says is what counts. Once
 *   it is in the user's account the driver acknowledges it, or consumes it when its product is
 *   one of `consumables`: Google refunds a purchase nobody acknowledged within three days.
 * - A webhook is a real-time developer notification, pushed by Cloud Pub/Sub with a token
 *   Google signed. A notification only says that a purchase changed, so the driver reads the
 *   purchase again: every event describes the purchase as it is at that moment, and is as old
 *   as that read.
 * - Google Play knows no user of the app: a purchase belongs to the user who hands it over
 *   first, and a purchase that takes the place of another one to the user of that one.
 * - The id of a holding is the SHA-256 of its purchase token, in hexadecimal digits.
 *
 * Usage:
 *   const billing = createBilling({
 *     drivers: {
 *       paddle: 'paddle',
 *       play: createGooglePlayDriver({
 *         packageName: 'com.example.app',
 *         clientEmail: env.GOOGLE_PLAY_CLIENT_EMAIL,
 *         privateKey: env.GOOGLE_PLAY_PRIVATE_KEY,
 *         pushAudience: 'https://example.com/billing/webhook/play',
 *       }),
 *     },
 *     products: { pro: { type: 'subscription', providerId: { paddle: 'pri_…', play: 'pro' } } },
 *     // …
 *   })
 *   await billing.verifyPurchase({ provider: 'play', userId, proof: { itemId, purchaseToken } })
 */
export function createGooglePlayDriver(config: GooglePlayDriverConfig): BillingDriver {
  const packageName = config?.packageName
  if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) {
    throw new BillingError(
      'billing: the Google Play driver needs `packageName`, the package name of the app, like "com.example.app".',
    )
  }
  const clientEmail = config.clientEmail
  if (typeof clientEmail !== 'string' || !EMAIL.test(clientEmail)) {
    throw new BillingError(
      "billing: the Google Play driver needs `clientEmail`: `client_email` of the service account's key file.",
    )
  }
  const privateKey = privateKeyOf(config.privateKey)
  if (!privateKey) {
    throw new BillingError(
      "billing: the Google Play driver needs `privateKey`: `private_key` of the service account's key file, with its BEGIN and END lines.",
    )
  }
  const pushAudience = config.pushAudience
  if (typeof pushAudience !== 'string' || pushAudience === '') {
    throw new BillingError(
      'billing: the Google Play driver needs `pushAudience`: the audience set on the push subscription that delivers the notifications.',
    )
  }
  const pushServiceAccount = config.pushServiceAccount ?? clientEmail
  if (typeof pushServiceAccount !== 'string' || !EMAIL.test(pushServiceAccount)) {
    throw new BillingError(
      'billing: `pushServiceAccount` of the Google Play driver has to be the e-mail address of a service account.',
    )
  }
  const consumables = config.consumables ?? []
  if (!Array.isArray(consumables) || consumables.some((id) => typeof id !== 'string' || !id)) {
    throw new BillingError(
      'billing: `consumables` of the Google Play driver has to be a list of product ids.',
    )
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // Looked up per call, so a test can replace the global `fetch` after the driver was made.
  const send: typeof fetch = (input, init) => (config.fetch ?? fetch)(input, init)
  const access = createGoogleAccess({ clientEmail, privateKey, fetch: send, timeoutMs })
  const checkPush = createGooglePushCheck({
    audience: pushAudience,
    serviceAccount: pushServiceAccount,
    fetch: send,
    timeoutMs,
  })

  /**
   * One call of the Android Publisher API. `what` names it in an error; the path carries the
   * purchase token and never leaves this function.
   */
  async function call(
    method: 'GET' | 'POST',
    path: string,
    what: string,
    token: string,
    body?: string,
  ): Promise<{ status: number; body: Fields | undefined }> {
    const bearer = await access.token()
    let response: Response
    try {
      response = await send(`${API}/${encodeURIComponent(packageName)}/purchases/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new BillingError(
        scrub(`billing: Google Play was not reached for ${what}: ${messageOfError(error)}`, token),
      )
    }
    return { status: response.status, body: fields(await response.json().catch(() => null)) }
  }

  /** Google's answer that is not the one the driver asked for, as an error without the token */
  function failed(what: string, status: number, body: Fields | undefined, token: string): never {
    // The token Google no longer takes is not sent again.
    if (status === 401) access.reset()
    const error = fields(body?.error)
    const reason = [text(error?.status), text(error?.message)].filter(Boolean).join(': ')
    const hint =
      status === 401 || status === 403
        ? ' Give the service account access to the app in the Play Console, under Users and permissions: "View financial data, orders, and cancellation survey responses" and "Manage orders and subscriptions".'
        : ''
    throw new BillingError(
      scrub(
        `billing: Google Play answered ${status} for ${what}${reason ? ` (${reason.slice(0, 300)})` : ''}.${hint}`,
        token,
      ),
    )
  }

  /** A purchase as Google holds it; `null` when Google knows none of this app under the token */
  async function read(path: string, what: string, token: string): Promise<Fields | null> {
    const { status, body } = await call('GET', path, what, token)
    if (status === 200 && body) return body
    // A token that is made up, of another app or of another kind of product, or one Google has
    // dropped: sixty days after a subscription ended.
    if (status === 400 || status === 404 || status === 410) return null
    return failed(what, status, body, token)
  }

  /**
   * Tells Google that a purchase was delivered, so it is not refunded (`acknowledge`, which
   * takes a body), or that it is used up (`consume`, which takes none).
   */
  async function confirm(path: string, what: string, token: string): Promise<void> {
    const { status, body } = await call(
      'POST',
      path,
      what,
      token,
      path.endsWith(':acknowledge') ? '{}' : undefined,
    )
    if (status < 200 || status >= 300) failed(what, status, body, token)
  }

  /** The subscription behind a purchase token, as events; `null` when Google knows none */
  async function readSubscription(token: string, hint: Hint = {}): Promise<Reading | null> {
    const path = `subscriptionsv2/tokens/${encodeURIComponent(token)}`
    const subscription = await read(path, 'purchases.subscriptionsv2.get', token)
    if (!subscription) return null
    // The state is as old as its read: a notification that is delivered late is read now, too.
    const now = Date.now()

    // Of several items the one that is paid says what the subscription is.
    const items = list(subscription.lineItems)
      .map((item) => fields(item))
      .filter((item) => item !== undefined)
    const item = items.find((entry) => text(entry.latestSuccessfulOrderId)) ?? items[0]
    const productId = text(item?.productId)
    if (!item || !productId) return null
    const order = text(item.latestSuccessfulOrderId)
    const expires = date(item.expiryTime)
    const holdingId = await holdingIdOf(token)

    // A change of plan and a new sign-up are a new purchase with a new token, which names the
    // one it follows: the old purchase is over, and its user is the user of this one.
    const linked = text(subscription.linkedPurchaseToken)
    const previous =
      linked ?? text(fields(subscription.outOfAppPurchaseContext)?.expiredPurchaseToken)
    const base = {
      occurredAt: new Date(now),
      providerId: productId,
      holdingId,
      ...(previous && PURCHASE_TOKEN.test(previous) && previous !== token
        ? { replacesHoldingId: await holdingIdOf(previous) }
        : {}),
    }
    // Every id starts with the holding: an order that Google carries over to the purchase that
    // replaces this one is another event there. The rest is what tells one state from the next,
    // so the same state is one event however often it is read.
    const id = (what: string, of?: string | number): string =>
      `${holdingId}:${what}${of === undefined ? '' : `:${of}`}`
    /** Access that is over: never later than now, whatever date Google still carries */
    const over = new Date(Math.min(expires?.getTime() ?? now, now))
    const ends = (eventId: string, accessEndsAt: Date): ProviderEvent => ({
      ...base,
      type: 'subscription.canceled',
      id: eventId,
      accessEndsAt,
    })
    /** The period that is paid for, under the id of its order */
    const paid = (until: Date): ProviderEvent => ({
      ...base,
      type:
        order && RENEWAL_ORDER.test(order)
          ? 'subscription.renewed'
          : linked
            ? 'subscription.changed'
            : 'subscription.started',
      id: id('paid', order ?? until.getTime()),
      currentPeriodEnd: until,
    })
    /** The order whose payment failed; without one, the last order that was paid */
    const declined = (context: unknown): string | undefined =>
      text(fields(fields(context)?.renewalDeclined)?.pendingOrderId) ?? order

    const state = text(subscription.subscriptionState)
    const canceled = fields(subscription.canceledStateContext)
    let events: ProviderEvent[] = []
    let granted = false

    if (canceled?.replacementCancellation !== undefined) {
      // Replaced by another purchase: over at once, also where its paid period runs on.
      events = [ends(id('replaced'), over)]
    } else if (state === 'SUBSCRIPTION_STATE_ACTIVE' && expires) {
      granted = true
      events = [paid(expires)]
      // Renewal is on again, or the end was moved: no order is made for either.
      if (hint.type === RESTARTED) {
        events.push({
          ...base,
          type: 'subscription.changed',
          id: id('restarted', hint.at ?? expires.getTime()),
          currentPeriodEnd: expires,
        })
      } else if (hint.type === DEFERRED) {
        events.push({
          ...base,
          type: 'subscription.changed',
          id: id('deferred', expires.getTime()),
          currentPeriodEnd: expires,
        })
      }
    } else if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' && expires) {
      // The payment failed and Google keeps trying: the customer keeps access meanwhile.
      granted = true
      events = [
        paid(expires),
        {
          ...base,
          type: 'payment.failed',
          id: id('failed', declined(subscription.inGracePeriodStateContext)),
        },
      ]
    } else if (state === 'SUBSCRIPTION_STATE_CANCELED' && expires) {
      // Renewal is off; what is paid for stays until its end.
      granted = true
      const at = date(fields(canceled?.userInitiatedCancellation)?.cancelTime) ?? expires
      const end = ends(id('canceled', at.getTime()), expires)
      events = expires.getTime() > now ? [paid(expires), end] : [end]
    } else if (state === 'SUBSCRIPTION_STATE_ON_HOLD') {
      // Google still tries to collect, and its word is to block access meanwhile.
      const unpaid = declined(subscription.onHoldStateContext)
      events = [
        { ...base, type: 'payment.failed', id: id('failed', unpaid) },
        ends(id('on-hold', unpaid), over),
      ]
    } else if (state === 'SUBSCRIPTION_STATE_PAUSED') {
      events = [ends(id('paused', expires?.getTime()), over)]
    } else if (state === 'SUBSCRIPTION_STATE_EXPIRED') {
      const revoked =
        hint.type === REVOKED || (hint.voidedOrder !== undefined && hint.voidedOrder === order)
      events = revoked
        ? [{ ...base, type: 'payment.refunded', id: id('revoked') }]
        : [ends(id('expired', expires?.getTime()), over)]
    }
    // Every other state is a purchase that is not paid: waiting for its payment, or given up.

    const acknowledge =
      granted && subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING'
    return {
      productId,
      events,
      ...(acknowledge
        ? {
            settle: () =>
              confirm(
                `subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`,
                'purchases.subscriptions.acknowledge',
                token,
              ),
          }
        : {}),
    }
  }

  /** The one-time purchase behind a purchase token, as events; `null` when Google knows none */
  async function readProduct(token: string): Promise<Reading | null> {
    const path = `productsv2/tokens/${encodeURIComponent(token)}`
    const purchase = await read(path, 'purchases.productsv2.getproductpurchasev2', token)
    if (!purchase) return null
    const now = Date.now()
    const item = fields(list(purchase.productLineItem)[0])
    const productId = text(item?.productId)
    if (!productId) return null
    const base = {
      occurredAt: new Date(now),
      providerId: productId,
      holdingId: await holdingIdOf(token),
    }
    const state = fields(purchase.purchaseStateContext)?.purchaseState

    if (state === 'CANCELLED') {
      // Taken back after it was paid: a refund. A purchase that was given up before its payment
      // came through has no time of completion, and there is no money to tell of.
      return {
        productId,
        events: date(purchase.purchaseCompletionTime)
          ? [{ ...base, type: 'payment.refunded', id: `${base.holdingId}:refunded` }]
          : [],
      }
    }
    if (state !== 'PURCHASED') return { productId, events: [] }

    const target = `products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`
    let settle: Reading['settle']
    if (consumables.includes(productId)) {
      // Consuming also acknowledges, and frees the product to be bought again.
      if (fields(item?.productOfferDetails)?.consumptionState !== 'CONSUMPTION_STATE_CONSUMED') {
        settle = () => confirm(`${target}:consume`, 'purchases.products.consume', token)
      }
    } else if (purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      settle = () => confirm(`${target}:acknowledge`, 'purchases.products.acknowledge', token)
    }
    return {
      productId,
      events: [{ ...base, type: 'purchase.completed', id: `${base.holdingId}:purchased` }],
      ...(settle ? { settle } : {}),
    }
  }

  return {
    name: 'google-play',

    async createCheckout() {
      throw new BillingError(
        'billing: a purchase at Google Play starts on the device, with the Digital Goods API. Hand its purchase token to billing.verifyPurchase().',
      )
    },

    async verifyPurchase(input) {
      const refuse: Refuse = (message) => {
        throw new BillingPurchaseError(`billing: ${message}.`, 'invalid')
      }
      const proof = fields(input.proof)
      const token = proof?.purchaseToken
      const itemId = proof?.itemId
      if (typeof token !== 'string' || !PURCHASE_TOKEN.test(token) || typeof itemId !== 'string') {
        return refuse(
          'the proof is not a purchase of Google Play: it is `{ itemId, purchaseToken }`, as the Digital Goods API hands a purchase over',
        )
      }
      // The item only says where to look. What was bought is what Google answers.
      const claimed = Object.hasOwn(input.products, itemId) ? input.products[itemId] : undefined
      if (!claimed) {
        return refuse('the proof names a product the config does not sell through this provider')
      }
      const subscription = claimed.type === 'subscription'
      const reading = subscription ? await readSubscription(token) : await readProduct(token)
      if (!reading) {
        return refuse(
          `Google Play knows no ${subscription ? 'subscription' : 'one-time purchase'} of this app under the purchase token`,
        )
      }
      const sold = Object.hasOwn(input.products, reading.productId)
        ? input.products[reading.productId]
        : undefined
      if (sold && sold.type !== claimed.type) {
        throw new BillingError(
          `billing: product "${sold.product}" is ${sold.type} in the config, and Google Play sold "${reading.productId}" as ${subscription ? 'a subscription' : 'a one-time purchase'}.`,
        )
      }
      if (reading.events.length === 0) {
        return refuse('the purchase is not paid: hand it over again once it is')
      }
      return { events: reading.events, ...(reading.settle ? { settle: reading.settle } : {}) }
    },

    async parseWebhook(request) {
      if (request.method !== 'POST') {
        throw new BillingWebhookError('Google delivers notifications with a POST', 405)
      }
      try {
        await checkPush(request.headers.get('Authorization'))
      } catch (error) {
        if (error instanceof GoogleTokenError) throw new BillingWebhookError(error.message, 401)
        throw error
      }
      let body: unknown
      try {
        body = JSON.parse(await request.text())
      } catch {
        throw new BillingWebhookError('the body is not JSON')
      }

      // Nobody is asked to deliver again what a second delivery would not change: a notification
      // only says that a purchase changed, and the purchase is read as it is now.
      const result = (
        reading?: Pick<Reading, 'events' | 'settle'> | null,
      ): DriverWebhookResult => ({
        events: reading?.events ?? [],
        ...(reading?.settle ? { settle: reading.settle } : {}),
        acceptUnmatched: true,
      })

      const notification = notificationOf(body)
      // A message of the topic that is no notification, or one for another app: answered and left.
      if (!notification || notification.packageName !== packageName) return result()

      const subscription = fields(notification.subscriptionNotification)
      if (subscription) {
        const token = subscription.purchaseToken
        if (typeof token !== 'string' || !PURCHASE_TOKEN.test(token)) return result()
        return result(
          await readSubscription(token, {
            type: Number(subscription.notificationType),
            at: millis(notification.eventTimeMillis),
          }),
        )
      }

      const product = fields(notification.oneTimeProductNotification)
      if (product) {
        const token = product.purchaseToken
        if (typeof token !== 'string' || !PURCHASE_TOKEN.test(token)) return result()
        return result(await readProduct(token))
      }

      const voided = fields(notification.voidedPurchaseNotification)
      if (voided) {
        const token = voided.purchaseToken
        if (typeof token !== 'string' || !PURCHASE_TOKEN.test(token)) return result()
        if (Number(voided.productType) === 1) {
          // A refund ends a subscription only when it is the refund of the period that runs.
          return result(await readSubscription(token, { voidedOrder: text(voided.orderId) }))
        }
        // Some pieces of a purchase of several: the purchase stays.
        if (Number(voided.refundType) === 2) return result()
        const holdingId = await holdingIdOf(token)
        return result({
          // Google names the purchase, not what was sold: billing takes the product of the holding.
          events: [
            {
              type: 'payment.refunded',
              id: `${holdingId}:refunded`,
              occurredAt: new Date(),
              holdingId,
            },
          ],
        })
      }

      // A test from the Play Console, a refund waiting for review: nothing about a purchase.
      return result()
    },

    async createManageUrl(input) {
      // Google Play manages subscriptions; a one-time purchase has nothing to change or cancel.
      const subscriptions = input.holdings.filter((holding) => holding.type === 'subscription')
      const holding =
        subscriptions.find((entry) => entry.status === 'active' || entry.status === 'past_due') ??
        subscriptions.at(-1)
      if (!holding) return null
      const productId = Object.hasOwn(input.providerIds, holding.product)
        ? input.providerIds[holding.product]
        : undefined
      if (!productId) return MANAGE_URL
      return `${MANAGE_URL}?${new URLSearchParams({ sku: productId, package: packageName }).toString()}`
    },
  }
}

/**
 * The developer notification of a push request: Cloud Pub/Sub wraps it in a message whose `data`
 * is base64, or sends it as it is where the subscription is set to unwrap.
 */
function notificationOf(body: unknown): Fields | undefined {
  const envelope = fields(body)
  const message = fields(envelope?.message)
  if (!message) return envelope
  const data = typeof message.data === 'string' ? fromBase64(message.data) : null
  if (!data) return undefined
  try {
    return fields(JSON.parse(new TextDecoder().decode(data)))
  } catch {
    return undefined
  }
}

/**
 * The id of a holding: the SHA-256 of its purchase token in hexadecimal digits. A token is too
 * long for a key of a store, and it stays with Google and the device.
 */
async function holdingIdOf(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A message for people and logs: never with the purchase token in it */
function scrub(message: string, token: string): string {
  return message.split(token).join('[purchase token]')
}

function fields(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A time as Google's API writes it: RFC 3339 */
function date(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** A time as a notification writes it: milliseconds since 1970, as a number or as digits */
function millis(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : undefined
}
