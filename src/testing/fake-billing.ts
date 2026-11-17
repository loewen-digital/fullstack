/**
 * Fake billing driver — records checkouts and lets a test deliver any provider event, as a
 * webhook or as the proof of a purchase made on the device.
 *
 * Usage:
 *   const fakeBilling = createFakeBillingDriver()
 *   const billing = createBilling({
 *     driver: fakeBilling,
 *     store: createMemoryBillingStore(),
 *     products: { pro: { type: 'subscription', providerId: 'pri_pro' } },
 *   })
 *
 *   await billing.handleWebhook(
 *     fakeBilling.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
 *   )
 *   expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
 *
 *   // A purchase from the device, handed over by the signed-in user:
 *   await billing.verifyPurchase({
 *     userId: 'u1',
 *     proof: fakeBilling.proof({ type: 'purchase.completed', providerId: 'pri_unlock' }),
 *   })
 */

import type {
  BillingCheckout,
  BillingDriver,
  BillingEventType,
  DriverCheckoutInput,
  DriverManageInput,
  DriverPurchaseInput,
  DriverPurchaseResult,
  ProviderEvent,
} from '../billing/index.js'
import { BillingPurchaseError, BillingWebhookError } from '../billing/index.js'

/**
 * An event for `webhook()` and `proof()`. Only `type` is required; a test that does not care gets
 * an id of its own per event, the current time, and a holding id derived from user and product,
 * so two events for the same user and product concern the same purchase or subscription.
 */
export interface FakeBillingEvent {
  type: BillingEventType
  /**
   * The `providerId` of a product in the billing config. Leave it out, and set `holdingId`, for
   * an event that names only its purchase, as a provider's refund may
   */
  providerId?: string
  /**
   * The user the provider names. In a proof: leave it out and the purchase is the one of the user
   * who hands the proof over; name another user to play a proof that is not theirs
   */
  userId?: string
  customerId?: string
  id?: string
  occurredAt?: Date
  holdingId?: string
  /** `subscription.started`, `renewed`, `changed` (default: `null`) */
  currentPeriodEnd?: Date | null
  /** `subscription.canceled` (default: the time of the event) */
  accessEndsAt?: Date
}

export interface FakeBillingDriver extends BillingDriver {
  /** Every checkout started since creation or the last clear() */
  readonly checkouts: DriverCheckoutInput[]
  /** Every manage link asked for since creation or the last clear() */
  readonly manageRequests: DriverManageInput[]
  /** Every proof handed over since creation or the last clear(), with the user who did */
  readonly purchases: DriverPurchaseInput[]
  /** A webhook request that delivers these events; hand it to `billing.handleWebhook` */
  webhook(events: FakeBillingEvent | FakeBillingEvent[]): Request
  /** A webhook request that fails verification, as one with a wrong signature would */
  invalidWebhook(): Request
  /**
   * The proof of a purchase made on the device that says these events; hand it to
   * `billing.verifyPurchase`. It is plain JSON, so it survives the request of a route under test
   */
  proof(events: FakeBillingEvent | FakeBillingEvent[]): unknown
  /** A proof that fails verification, as a forged one would */
  invalidProof(): unknown
  verifyPurchase(input: DriverPurchaseInput): Promise<DriverPurchaseResult>
  /** Forget recorded checkouts, manage requests and purchases */
  clear(): void
}

const VALID = 'fake-billing-signature'

export function createFakeBillingDriver(): FakeBillingDriver {
  const checkouts: DriverCheckoutInput[] = []
  const manageRequests: DriverManageInput[] = []
  const purchases: DriverPurchaseInput[] = []
  let counter = 0

  const request = (events: unknown, signature: string): Request =>
    new Request('https://fake-billing.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fake-Signature': signature },
      body: JSON.stringify(events),
    })

  /** `owner` is the user who hands a proof over: the purchase is theirs unless the event says otherwise */
  function toProviderEvent(event: FakeBillingEvent, owner?: string): ProviderEvent {
    const occurredAt = event.occurredAt ?? new Date()
    const base = {
      id: event.id ?? `fake_evt_${++counter}`,
      occurredAt,
      userId: event.userId,
      customerId: event.customerId,
      providerId: event.providerId,
      holdingId:
        event.holdingId ??
        `fake_${event.userId ?? owner ?? event.customerId ?? 'nobody'}_${event.providerId}`,
    }
    switch (event.type) {
      case 'subscription.started':
      case 'subscription.renewed':
      case 'subscription.changed':
        return { ...base, type: event.type, currentPeriodEnd: event.currentPeriodEnd ?? null }
      case 'subscription.canceled':
        return { ...base, type: event.type, accessEndsAt: event.accessEndsAt ?? occurredAt }
      default:
        return { ...base, type: event.type }
    }
  }

  // JSON carried the dates as strings.
  function revived<T extends object>(event: T): T {
    const fields = { ...event } as Record<string, unknown>
    for (const field of ['occurredAt', 'currentPeriodEnd', 'accessEndsAt']) {
      if (typeof fields[field] === 'string') fields[field] = new Date(fields[field])
    }
    return fields as T
  }

  return {
    name: 'fake',
    checkouts,
    manageRequests,
    purchases,

    async createCheckout(input): Promise<BillingCheckout> {
      checkouts.push(input)
      const id = `fake_checkout_${checkouts.length}`
      return { id, url: `https://fake-billing.test/checkout/${id}` }
    },

    async parseWebhook(incoming) {
      if (incoming.headers.get('X-Fake-Signature') !== VALID) {
        throw new BillingWebhookError('invalid signature', 401)
      }
      const events = (await incoming.json()) as ProviderEvent[]
      return { events: events.map(revived) }
    },

    async verifyPurchase(input) {
      purchases.push(input)
      const proof = input.proof
      if (
        typeof proof !== 'object' ||
        proof === null ||
        !('fakeBillingProof' in proof) ||
        proof.fakeBillingProof !== VALID ||
        !('events' in proof) ||
        !Array.isArray(proof.events)
      ) {
        throw new BillingPurchaseError('the proof does not verify', 'invalid')
      }
      return {
        events: (proof.events as FakeBillingEvent[]).map((event) =>
          toProviderEvent(revived(event), input.userId),
        ),
      }
    },

    async createManageUrl(input) {
      manageRequests.push(input)
      return `https://fake-billing.test/manage/${encodeURIComponent(input.userId)}`
    },

    webhook(events) {
      const told = Array.isArray(events) ? events : [events]
      return request(
        told.map((event) => toProviderEvent(event)),
        VALID,
      )
    },

    invalidWebhook() {
      return request([], 'wrong')
    },

    proof(events) {
      // An id per event now, so the same proof handed over twice tells the same events.
      const told = (Array.isArray(events) ? events : [events]).map((event) => ({
        ...event,
        id: event.id ?? `fake_evt_${++counter}`,
        occurredAt: event.occurredAt ?? new Date(),
      }))
      return { fakeBillingProof: VALID, events: told }
    },

    invalidProof() {
      return { fakeBillingProof: 'wrong', events: [] }
    },

    clear() {
      checkouts.length = 0
      manageRequests.length = 0
      purchases.length = 0
    },
  }
}
