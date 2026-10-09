/**
 * Fake billing driver — records checkouts and lets a test deliver any provider event.
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
 */

import type {
  BillingCheckout,
  BillingDriver,
  BillingEventType,
  DriverCheckoutInput,
  DriverManageInput,
  ProviderEvent,
} from '../billing/index.js'
import { BillingWebhookError } from '../billing/index.js'

/**
 * An event for `webhook()`. `type` and `providerId` are required; a test that does not care gets
 * an id of its own per event, the current time, and a holding id derived from user and product,
 * so two events for the same user and product concern the same purchase or subscription.
 */
export interface FakeBillingEvent {
  type: BillingEventType
  /** The `providerId` of a product in the billing config */
  providerId: string
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
  /** A webhook request that delivers these events; hand it to `billing.handleWebhook` */
  webhook(events: FakeBillingEvent | FakeBillingEvent[]): Request
  /** A webhook request that fails verification, as one with a wrong signature would */
  invalidWebhook(): Request
  /** Forget recorded checkouts and manage requests */
  clear(): void
}

const VALID = 'fake-billing-signature'

export function createFakeBillingDriver(): FakeBillingDriver {
  const checkouts: DriverCheckoutInput[] = []
  const manageRequests: DriverManageInput[] = []
  let counter = 0

  const request = (events: unknown, signature: string): Request =>
    new Request('https://fake-billing.test/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fake-Signature': signature },
      body: JSON.stringify(events),
    })

  function toProviderEvent(event: FakeBillingEvent): ProviderEvent {
    const occurredAt = event.occurredAt ?? new Date()
    const base = {
      id: event.id ?? `fake_evt_${++counter}`,
      occurredAt,
      userId: event.userId,
      customerId: event.customerId,
      providerId: event.providerId,
      holdingId:
        event.holdingId ??
        `fake_${event.userId ?? event.customerId ?? 'nobody'}_${event.providerId}`,
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

  return {
    name: 'fake',
    checkouts,
    manageRequests,

    async createCheckout(input): Promise<BillingCheckout> {
      checkouts.push(input)
      const id = `fake_checkout_${checkouts.length}`
      return { id, url: `https://fake-billing.test/checkout/${id}` }
    },

    async parseWebhook(incoming) {
      if (incoming.headers.get('X-Fake-Signature') !== VALID) {
        throw new BillingWebhookError('invalid signature', 401)
      }
      const events = (await incoming.json()) as (Record<string, unknown> & ProviderEvent)[]
      // JSON carried the dates as strings.
      return {
        events: events.map((event) => {
          const revived: Record<string, unknown> = { ...event }
          for (const field of ['occurredAt', 'currentPeriodEnd', 'accessEndsAt']) {
            if (typeof revived[field] === 'string') revived[field] = new Date(revived[field])
          }
          return revived as ProviderEvent
        }),
      }
    },

    async createManageUrl(input) {
      manageRequests.push(input)
      return `https://fake-billing.test/manage/${encodeURIComponent(input.userId)}`
    },

    webhook(events) {
      return request((Array.isArray(events) ? events : [events]).map(toProviderEvent), VALID)
    },

    invalidWebhook() {
      return request([], 'wrong')
    },

    clear() {
      checkouts.length = 0
      manageRequests.length = 0
    },
  }
}
