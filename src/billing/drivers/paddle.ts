import { BillingError, BillingWebhookError } from '../errors.js'
import type { BillingDriver, PaddleDriverConfig, ProviderEvent } from '../types.js'

const LIVE = 'https://api.paddle.com'
const SANDBOX = 'https://sandbox-api.paddle.com'
const SIGNATURE_HEADER = 'Paddle-Signature'
/** The key in a transaction's `custom_data` that carries the app's user id */
const USER_KEY = 'userId'

type Fields = Record<string, unknown>

/**
 * Paddle Billing (not Paddle Classic) behind the billing module. Talks to Paddle with `fetch`
 * and verifies webhooks with Web Crypto, so it runs on Node and on Cloudflare Workers.
 *
 * - A checkout is a Paddle transaction with the user id in its `custom_data`. Its URL is a page
 *   of the app that carries Paddle.js (`checkoutUrl`, or the default payment link set in Paddle)
 *   with `?_ptxn=<transaction>`; Paddle has no checkout page of its own for the web.
 * - A webhook is verified on its raw body: HMAC-SHA256 over `<ts>:<body>` with the secret of the
 *   notification destination, and a timestamp within the tolerance.
 * - The manage link is a session of Paddle's customer portal.
 *
 * `successUrl`, `cancelUrl` and `email` of a checkout and `returnUrl` of the manage link have no
 * server-side counterpart in Paddle; the page that opens the checkout sets them in Paddle.js.
 */
export function createPaddleDriver(config: PaddleDriverConfig): BillingDriver {
  if (!config.apiKey || !config.webhookSecret) {
    throw new BillingError(
      'billing: the Paddle driver needs `apiKey` and `webhookSecret`; one of them is empty.',
    )
  }
  const baseUrl = config.sandbox ? SANDBOX : LIVE
  const tolerance = (config.toleranceSeconds ?? 5) * 1000
  let key: Promise<CryptoKey> | undefined

  async function api(path: string, body: Fields): Promise<Fields> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const answer = fields(await response.json().catch(() => null))
    if (!response.ok) {
      // Paddle's error code and detail describe the request, never the key.
      const error = fields(answer?.error)
      const reason = [text(error?.code), text(error?.detail)].filter(Boolean).join(': ')
      throw new BillingError(
        `billing: Paddle answered ${response.status} for POST ${path}${reason ? ` (${reason})` : ''}`,
      )
    }
    const data = fields(answer?.data)
    if (!data) throw new BillingError(`billing: Paddle's answer for POST ${path} has no data`)
    return data
  }

  async function verify(header: string | null, body: Uint8Array<ArrayBuffer>): Promise<void> {
    let timestamp: string | undefined
    const signatures: string[] = []
    for (const part of (header ?? '').split(';')) {
      const [name, value] = part.split('=', 2).map((piece) => piece.trim())
      if (name === 'ts') timestamp = value
      // More than one `h1` while a secret is rotated out; one of them has to match.
      else if (name === 'h1' && value) signatures.push(value)
    }
    if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
      throw new BillingWebhookError(`no valid ${SIGNATURE_HEADER} header`, 401)
    }
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > tolerance) {
      throw new BillingWebhookError('the signature is outside the time tolerance', 401)
    }

    const prefix = new TextEncoder().encode(`${timestamp}:`)
    const signed = new Uint8Array(prefix.length + body.length)
    signed.set(prefix)
    signed.set(body, prefix.length)

    key ??= crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(config.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    for (const signature of signatures) {
      const bytes = fromHex(signature)
      // `verify` compares in constant time.
      if (bytes && (await crypto.subtle.verify('HMAC', await key, bytes, signed))) return
    }
    throw new BillingWebhookError('invalid signature', 401)
  }

  return {
    name: 'paddle',

    async createCheckout(input) {
      const transaction = await api('/transactions', {
        items: [{ price_id: input.providerId, quantity: 1 }],
        custom_data: { [USER_KEY]: input.userId },
        ...(isPaddleId(input.customerId, 'ctm') ? { customer_id: input.customerId } : {}),
        ...(config.checkoutUrl ? { checkout: { url: config.checkoutUrl } } : {}),
      })
      const id = text(transaction.id)
      if (!id) throw new BillingError("billing: Paddle's transaction has no id")
      return { id, url: text(fields(transaction.checkout)?.url) ?? null }
    },

    async parseWebhook(request) {
      if (request.method !== 'POST') {
        throw new BillingWebhookError('Paddle delivers webhooks with a POST', 405)
      }
      const body = new Uint8Array(await request.arrayBuffer())
      await verify(request.headers.get(SIGNATURE_HEADER), body)

      let notification: unknown
      try {
        notification = JSON.parse(new TextDecoder().decode(body))
      } catch {
        throw new BillingWebhookError('the body is not JSON')
      }
      return { events: toEvents(notification) }
    },

    async createManageUrl(input) {
      // No customer before the first event; an id of another driver (console) is not Paddle's.
      if (!isPaddleId(input.customerId, 'ctm')) return null
      const session = await api(
        `/customers/${encodeURIComponent(input.customerId)}/portal-sessions`,
        {},
      )
      const url = text(fields(fields(session.urls)?.general)?.overview)
      if (!url) throw new BillingError("billing: Paddle's portal session has no overview link")
      return url
    },
  }
}

/**
 * The provider-neutral events of one Paddle notification. A notification billing has no use for
 * (another event type, a partial or pending refund) gives none and is answered with 200.
 */
function toEvents(notification: unknown): ProviderEvent[] {
  const envelope = fields(notification)
  const id = text(envelope?.event_id)
  const type = text(envelope?.event_type)
  const occurredAt = date(envelope?.occurred_at)
  const data = fields(envelope?.data)
  if (!id || !type || !occurredAt || !data) {
    throw new BillingWebhookError('the body is not a Paddle notification')
  }
  const base = {
    occurredAt,
    userId: text(fields(data.custom_data)?.[USER_KEY]),
    customerId: text(data.customer_id),
  }

  if (type === 'transaction.completed') {
    const transactionId = required(data.id, 'transaction id')
    const subscriptionId = text(data.subscription_id)
    const prices = list(data.items)
      .map((item) => fields(fields(item)?.price))
      .filter((price) => price !== undefined)
    const events: ProviderEvent[] = []
    // The first event keeps Paddle's ids, so a refund of the transaction finds its holding.
    const suffixed = (value: string, suffix: string): string =>
      events.length === 0 ? value : `${value}:${suffix}`

    const oneTime = prices.filter((price) => price.billing_cycle == null)
    for (const priceId of new Set(oneTime.map((price) => text(price.id)))) {
      if (!priceId) continue
      events.push({
        ...base,
        id: suffixed(id, priceId),
        type: 'purchase.completed',
        providerId: priceId,
        holdingId: suffixed(transactionId, priceId),
      })
    }

    // The first payment of a subscription is `subscription.created`; only a renewal counts here.
    const recurring = text(prices.find((price) => price.billing_cycle != null)?.id)
    if (subscriptionId && recurring && data.origin === 'subscription_recurring') {
      events.push({
        ...base,
        id: suffixed(id, subscriptionId),
        type: 'subscription.renewed',
        providerId: recurring,
        holdingId: subscriptionId,
        currentPeriodEnd: date(fields(data.billing_period)?.ends_at) ?? null,
      })
    }
    return events
  }

  if (type.startsWith('subscription.')) {
    // Every subscription event carries the whole subscription. Its state decides, not the name
    // of the event: `subscription.updated` also follows a cancel, and must not undo it.
    const subscription = {
      ...base,
      id,
      holdingId: required(data.id, 'subscription id'),
      // A subscription is one holding; of several items the first one says what it is.
      providerId: required(
        fields(fields(list(data.items)[0])?.price)?.id,
        'price of the subscription',
      ),
    }
    const currentPeriodEnd = date(fields(data.current_billing_period)?.ends_at) ?? null
    const ends = (accessEndsAt: Date): ProviderEvent[] => [
      { ...subscription, type: 'subscription.canceled', accessEndsAt },
    ]

    if (type === 'subscription.created') {
      return [{ ...subscription, type: 'subscription.started', currentPeriodEnd }]
    }
    switch (data.status) {
      case 'canceled':
        return ends(date(data.canceled_at) ?? occurredAt)
      case 'paused':
        return ends(date(data.paused_at) ?? occurredAt)
      case 'past_due':
        return [{ ...subscription, type: 'payment.failed' }]
      case 'active':
      case 'trialing': {
        const scheduled = fields(data.scheduled_change)
        const effectiveAt = date(scheduled?.effective_at)
        if (effectiveAt && (scheduled?.action === 'cancel' || scheduled?.action === 'pause')) {
          return ends(effectiveAt)
        }
        return [{ ...subscription, type: 'subscription.changed', currentPeriodEnd }]
      }
      default:
        return []
    }
  }

  if (type === 'adjustment.created' || type === 'adjustment.updated') {
    const moneyBack = data.action === 'refund' || data.action === 'chargeback'
    // A refund of everything is `type: full`, or names its items and takes each of them in full:
    // that is what Paddle's dashboard sends, with `type: partial` on the adjustment itself.
    const items = list(data.items).map((item) => fields(item))
    const everything =
      data.type === 'full' || (items.length > 0 && items.every((item) => item?.type === 'full'))
    if (!moneyBack || data.status !== 'approved' || !everything) return []
    // An adjustment names its transaction, not what was sold: no `providerId`.
    return [
      {
        id,
        occurredAt,
        type: 'payment.refunded',
        customerId: base.customerId,
        holdingId: text(data.subscription_id) ?? required(data.transaction_id, 'transaction id'),
      },
    ]
  }

  return []
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

function date(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** A field a verified notification of this type always has; without it the delivery is refused */
function required(value: unknown, what: string): string {
  const found = text(value)
  if (!found) throw new BillingWebhookError(`the notification has no ${what}`)
  return found
}

function isPaddleId(value: string | null, prefix: string): value is string {
  return value !== null && value.startsWith(`${prefix}_`)
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
