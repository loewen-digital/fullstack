import { BillingError, BillingPurchaseError, BillingWebhookError } from '../errors.js'
import type { AppStoreDriverConfig, BillingDriver, ProviderEvent } from '../types.js'
import {
  APPLE_ROOT_CA_G3,
  AppleSignatureError,
  fromBase64,
  parseCertificate,
  verifyAppleJws,
} from './app-store-jws.js'
import type { Certificate } from './app-store-jws.js'

/** Apple's page where a customer changes or cancels a subscription */
const MANAGE_URL = 'https://apps.apple.com/account/subscriptions'
/** How Apple writes the environment into what it signs */
const ENVIRONMENTS = { production: 'Production', sandbox: 'Sandbox' } as const
/**
 * What Apple sells, and whether it is paid per period. A non-renewing subscription has no end
 * Apple knows of: to billing it is a one-time purchase.
 */
const KINDS: Record<string, boolean> = {
  'Auto-Renewable Subscription': true,
  'Non-Renewing Subscription': false,
  'Non-Consumable': false,
  Consumable: false,
}
/** The notifications that tell something about a purchase; every other one is answered and left */
const READ = new Set([
  'ONE_TIME_CHARGE',
  'SUBSCRIBED',
  'DID_RENEW',
  'DID_CHANGE_RENEWAL_PREF',
  'OFFER_REDEEMED',
  'DID_CHANGE_RENEWAL_STATUS',
  'DID_FAIL_TO_RENEW',
  'GRACE_PERIOD_EXPIRED',
  'EXPIRED',
  'REFUND',
  'REVOKE',
  'REFUND_REVERSED',
])
/** An id that is safe as a key of a store: Apple's are digits, or a UUID */
const ID = /^[\w.-]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The namespace of the account tokens: 1f6dc268-0ded-4a8f-85f4-e05e552c9048 */
const ACCOUNT_NAMESPACE = [
  0x1f, 0x6d, 0xc2, 0x68, 0x0d, 0xed, 0x4a, 0x8f, 0x85, 0xf4, 0xe0, 0x5e, 0x55, 0x2c, 0x90, 0x48,
]

type Fields = Record<string, unknown>
/** Refuses what was handed in, in the way of the path it came on: a proof or a delivery */
type Refuse = (message: string, status?: number) => never

/** What the driver reads of a transaction the App Store signed */
interface Transaction {
  id: string
  /** The first transaction of the purchase: the same for every renewal of a subscription */
  holdingId: string
  productId: string
  subscription: boolean
  /** Apple renewed the subscription; otherwise the customer bought */
  renewal: boolean
  /** Replaced by an upgrade: the transaction of the upgrade counts */
  upgraded: boolean
  /** Bought by this customer, not shared with them by their family or a group */
  owned: boolean
  purchasedAt: number
  /** The end of the paid period; `null` for everything but a subscription */
  expiresAt: number | null
  /** When Apple refunded or took the transaction back */
  revokedAt: number | null
  signedAt: number | null
  /** The account token the app set when buying, in lower case */
  accountToken: string | undefined
}

/**
 * The account token of a user: what the app sets as `appAccountToken` when it buys, so Apple
 * signs it into the transaction and the driver knows whose purchase it is. A version 5 UUID of
 * the user id in a namespace of this driver (`1f6dc268-0ded-4a8f-85f4-e05e552c9048`): the same
 * id always gives the same token, and the token does not give the id away.
 */
export async function appStoreAccountToken(userId: string): Promise<string> {
  if (typeof userId !== 'string' || userId === '') {
    throw new BillingError('billing: userId must be a non-empty string')
  }
  const name = new TextEncoder().encode(userId)
  const input = new Uint8Array(ACCOUNT_NAMESPACE.length + name.length)
  input.set(ACCOUNT_NAMESPACE)
  input.set(name, ACCOUNT_NAMESPACE.length)
  // SHA-1 is what a version 5 UUID is made of; nothing here rests on it being hard to collide.
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Apple's in-app purchase behind the billing module, for a web app shipped as an iOS app. The
 * purchase is made on the device with StoreKit; the driver verifies what the App Store signed
 * and reads it. Web Crypto only: no dependency, no request to Apple and no secret, so it runs on
 * Node and on Cloudflare Workers.
 *
 * - A purchase is the signed transaction the app hands over (`jwsRepresentation` of StoreKit 2):
 *   the signature and its certificate chain up to Apple's root, the bundle id and the
 *   environment are checked, and the account token in it has to be the one of the user.
 * - A webhook is an App Store Server Notification of version 2, verified the same way.
 * - One driver takes one environment. Sandbox purchases cost nothing, so they get a provider of
 *   their own: the same driver twice, under two names.
 * - The manage link is Apple's page for subscriptions.
 *
 * Usage:
 *   const billing = createBilling({
 *     drivers: {
 *       paddle: 'paddle',
 *       app: createAppStoreDriver({ bundleId: 'com.example.app', environment: 'production' }),
 *     },
 *     products: { pro: { type: 'subscription', providerId: { paddle: 'pri_…', app: 'pro.monthly' } } },
 *     // …
 *   })
 *   const token = await appStoreAccountToken(userId) // the app buys with it
 *   await billing.verifyPurchase({ provider: 'app', userId, proof: signedTransaction })
 */
export function createAppStoreDriver(config: AppStoreDriverConfig): BillingDriver {
  const bundleId = config?.bundleId
  if (typeof bundleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(bundleId)) {
    throw new BillingError(
      'billing: the App Store driver needs `bundleId`, the bundle id of the app, like "com.example.app".',
    )
  }
  if (!Object.hasOwn(ENVIRONMENTS, config.environment)) {
    throw new BillingError(
      "billing: the App Store driver needs `environment`: 'production' or 'sandbox'. One driver takes one of them.",
    )
  }
  const environment = ENVIRONMENTS[config.environment]
  const roots = rootsOf(config.rootCertificates)

  /** The payload of a JWS the App Store signed; anything else is refused */
  async function signed(jws: unknown, refuse: Refuse): Promise<Fields> {
    try {
      return await verifyAppleJws(jws, roots, Date.now())
    } catch (error) {
      if (error instanceof AppleSignatureError) refuse(error.message, 401)
      throw error
    }
  }

  /** A verified transaction of this app and this environment; one of another is refused */
  function transactionOf(payload: Fields, refuse: Refuse): Transaction {
    if (payload.bundleId !== bundleId) refuse('the transaction is one of another app')
    if (payload.environment !== environment) {
      refuse(`the transaction is not from Apple's ${config.environment} environment`)
    }
    const id = text(payload.transactionId)
    const original = text(payload.originalTransactionId) ?? id
    const productId = text(payload.productId)
    const purchasedAt = millis(payload.purchaseDate)
    if (!id || !original || !ID.test(id) || !ID.test(original) || !productId || !purchasedAt) {
      refuse('the transaction has no id, product or purchase date')
    }
    const kind = typeof payload.type === 'string' ? payload.type : ''
    // A kind the driver does not know is not guessed at: read as a one-time purchase, a
    // subscription would be paid for good.
    if (!Object.hasOwn(KINDS, kind)) refuse('the transaction is of a kind the driver does not know')
    const subscription = KINDS[kind] === true
    const expiresAt = subscription ? (millis(payload.expiresDate) ?? null) : null
    // A subscription without an end would be paid for good.
    if (subscription && expiresAt === null) refuse('the subscription has no date it is paid until')
    const token = typeof payload.appAccountToken === 'string' ? payload.appAccountToken : ''
    return {
      id,
      holdingId: original,
      productId,
      subscription,
      renewal: payload.transactionReason === 'RENEWAL',
      upgraded: payload.isUpgraded === true,
      owned: payload.inAppOwnershipType === undefined || payload.inAppOwnershipType === 'PURCHASED',
      purchasedAt,
      expiresAt,
      revokedAt: millis(payload.revocationDate) ?? null,
      signedAt: millis(payload.signedDate) ?? null,
      accountToken: UUID.test(token.toLowerCase()) ? token.toLowerCase() : undefined,
    }
  }

  return {
    name: 'app-store',

    async createCheckout() {
      throw new BillingError(
        'billing: a purchase at the App Store starts on the device, with StoreKit. Hand its signed transaction to billing.verifyPurchase().',
      )
    },

    async verifyPurchase(input) {
      const refuse: Refuse = (message) => {
        throw new BillingPurchaseError(`billing: ${message}.`, 'invalid')
      }
      const transaction = transactionOf(await signed(input.proof, refuse), refuse)
      if (!transaction.owned) {
        refuse('the transaction was shared with this customer, not bought by them')
      }
      if (transaction.accountToken === undefined) {
        refuse(
          'the transaction names no account: the app has to buy with the appAccountToken of the user',
        )
      }
      if (transaction.accountToken !== (await appStoreAccountToken(input.userId))) {
        throw new BillingPurchaseError(
          'billing: this purchase belongs to another user.',
          'other-user',
        )
      }
      const sold = Object.hasOwn(input.products, transaction.productId)
        ? input.products[transaction.productId]
        : undefined
      if (sold && (sold.type === 'subscription') !== transaction.subscription) {
        throw new BillingError(
          `billing: product "${sold.product}" is ${sold.type} in the config, and the App Store sold "${transaction.productId}" as ${transaction.subscription ? 'a subscription' : 'a one-time purchase'}.`,
        )
      }
      const now = Date.now()
      return { events: transactionEvents(transaction, transaction.signedAt ?? now, now) }
    },

    async parseWebhook(request) {
      const refuse: Refuse = (message, status) => {
        throw new BillingWebhookError(message, status)
      }
      if (request.method !== 'POST') refuse('Apple delivers notifications with a POST', 405)
      let body: unknown
      try {
        body = JSON.parse(await request.text())
      } catch {
        refuse('the body is not JSON')
      }
      const signedPayload = fields(body)?.signedPayload
      if (typeof signedPayload !== 'string') {
        refuse('the body is not an App Store Server Notification of version 2')
      }
      const payload = await signed(signedPayload, refuse)
      const type = text(payload.notificationType)
      const uuid = text(payload.notificationUUID)
      const signedAt = millis(payload.signedDate)
      if (!type || !uuid || !ID.test(uuid) || !signedAt) {
        refuse('the body is not an App Store Server Notification of version 2')
      }

      // A notification about something else than a purchase (a summary, a token) carries no `data`.
      const data = fields(payload.data)
      if (!data) return { events: [] }
      if (data.bundleId !== bundleId) refuse('the notification is for another app')
      if (data.environment !== environment) {
        refuse(`the notification is not from Apple's ${config.environment} environment`)
      }
      if (!READ.has(type) || data.signedTransactionInfo === undefined) return { events: [] }

      // Signed on its own, and checked on its own: the app and the environment once more.
      const transaction = transactionOf(await signed(data.signedTransactionInfo, refuse), refuse)
      // Family Sharing and seats of a group are not sold through billing.
      if (!transaction.owned) return { events: [] }

      const upgrade =
        (type === 'DID_CHANGE_RENEWAL_PREF' || type === 'OFFER_REDEEMED') &&
        payload.subtype === 'UPGRADE'
      return {
        events: [
          // What the transaction itself says comes first: a notification whose predecessor was
          // lost still brings the purchase it is about.
          ...transactionEvents(transaction, signedAt, Date.now(), upgrade),
          ...changeEvents(type, payload.subtype, data.status, uuid, signedAt, transaction),
        ],
      }
    },

    async createManageUrl(input) {
      // Apple manages subscriptions; a one-time purchase has nothing to change or cancel.
      return input.holdings.some((holding) => holding.type === 'subscription') ? MANAGE_URL : null
    },
  }
}

/**
 * What a transaction says by itself, the same whether the app handed it over or a notification
 * brought it, so both are one event: the purchase or the paid period under the id of the
 * transaction, and its refund.
 *
 * - A transaction that is no longer what the customer holds says nothing: one that was replaced
 *   by an upgrade, and a subscription period that is over. Without this, an old transaction
 *   would start a subscription that nothing ever ends.
 * - An event is as old as its purchase, and never younger than its signature: Apple signs a
 *   renewal up to a day before its period starts, and a cancel in that day has to come after it.
 */
function transactionEvents(
  transaction: Transaction,
  signedAt: number,
  now: number,
  upgrade = false,
): ProviderEvent[] {
  if (!transaction.owned || transaction.upgraded) return []
  const { id, expiresAt, revokedAt } = transaction
  const base = {
    providerId: transaction.productId,
    holdingId: transaction.holdingId,
    customerId: transaction.accountToken,
  }
  const at = (time: number): Date => new Date(Math.min(time, signedAt))
  // A refund of a period that had ended before leaves the subscription as it is.
  const refund: ProviderEvent[] =
    revokedAt !== null && (expiresAt === null || revokedAt < expiresAt)
      ? [
          {
            ...base,
            type: 'payment.refunded',
            // A refund that was reversed and then given again is a second refund.
            id: `${id}:revoked:${revokedAt}`,
            occurredAt: at(revokedAt),
          },
        ]
      : []

  if (expiresAt === null) {
    return [
      { ...base, type: 'purchase.completed', id, occurredAt: at(transaction.purchasedAt) },
      ...refund,
    ]
  }
  if (expiresAt <= now && refund.length === 0) return []
  return [
    {
      ...base,
      type: transaction.renewal
        ? 'subscription.renewed'
        : upgrade
          ? 'subscription.changed'
          : 'subscription.started',
      id,
      occurredAt: at(transaction.purchasedAt),
      currentPeriodEnd: new Date(expiresAt),
    },
    ...refund,
  ]
}

/**
 * What a notification says beyond its transaction: a change no transaction is made for. The id
 * is the notification's, which Apple keeps when it delivers again.
 */
function changeEvents(
  type: string,
  subtype: unknown,
  status: unknown,
  uuid: string,
  signedAt: number,
  transaction: Transaction,
): ProviderEvent[] {
  const change = {
    id: uuid,
    occurredAt: new Date(signedAt),
    providerId: transaction.productId,
    holdingId: transaction.holdingId,
    customerId: transaction.accountToken,
  }
  const { expiresAt } = transaction

  if (expiresAt === null) {
    // The refund went back to Apple: the purchase is paid again.
    return type === 'REFUND_REVERSED' && transaction.revokedAt === null
      ? [{ ...change, type: 'purchase.completed' }]
      : []
  }

  const periodEnd = new Date(expiresAt)
  const ends = (accessEndsAt: Date): ProviderEvent => ({
    ...change,
    type: 'subscription.canceled',
    accessEndsAt,
  })
  switch (type) {
    case 'DID_CHANGE_RENEWAL_STATUS':
      if (subtype === 'AUTO_RENEW_DISABLED') return [ends(periodEnd)]
      // Renewal is on again. Only a subscription that runs is reported as running: turning
      // renewal on does not pay a failed payment.
      if (subtype === 'AUTO_RENEW_ENABLED' && (status === undefined || status === 1)) {
        return [{ ...change, type: 'subscription.changed', currentPeriodEnd: periodEnd }]
      }
      return []
    case 'DID_FAIL_TO_RENEW':
      // With a grace period set in App Store Connect the customer keeps access while Apple
      // tries. Without one Apple's word is to stop: the subscription ends with what was paid.
      return subtype === 'GRACE_PERIOD'
        ? [{ ...change, type: 'payment.failed' }]
        : [
            { ...change, type: 'payment.failed' },
            { ...ends(periodEnd), id: `${uuid}:ended` },
          ]
    case 'GRACE_PERIOD_EXPIRED':
      return [ends(new Date(signedAt))]
    case 'EXPIRED':
      return [ends(periodEnd)]
    case 'REFUND_REVERSED':
      if (transaction.revokedAt !== null) return []
      // Paid again, for the period it was paid for.
      return expiresAt > signedAt
        ? [{ ...change, type: 'subscription.renewed', currentPeriodEnd: periodEnd }]
        : [ends(periodEnd)]
    default:
      return []
  }
}

/** The certificates a chain may end in: Apple's root, or what the config hands in for a test */
function rootsOf(configured: AppStoreDriverConfig['rootCertificates']): Certificate[] {
  if (configured === undefined) {
    return [parseCertificate(fromBase64(APPLE_ROOT_CA_G3)!)]
  }
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new BillingError(
      'billing: `rootCertificates` of the App Store driver is empty; leave it out to trust Apple.',
    )
  }
  return configured.map((entry: unknown, index) => {
    const der =
      typeof entry === 'string'
        ? fromBase64(entry.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''))
        : entry instanceof Uint8Array
          ? new Uint8Array(entry)
          : null
    try {
      if (!der) throw new AppleSignatureError('not a certificate')
      return parseCertificate(der)
    } catch {
      throw new BillingError(
        `billing: \`rootCertificates[${index}]\` of the App Store driver is not a certificate, as DER bytes, base64 or PEM.`,
      )
    }
  })
}

function fields(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A time as Apple writes it: milliseconds since 1970 */
function millis(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
