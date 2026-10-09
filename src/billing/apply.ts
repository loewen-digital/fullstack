import type {
  BillingAccountRecord,
  BillingEvent,
  BillingHolding,
  BillingProductType,
} from './types.js'

export type ApplyOutcome = 'applied' | 'unchanged' | 'duplicate' | 'stale'

/** The account of a user no event was applied for yet */
export function emptyAccount(userId: string): BillingAccountRecord {
  return { userId, customerId: null, holdings: [], appliedEvents: [] }
}

/**
 * Applies one event to an account and says what came of it. Pure: the account handed in is not
 * touched, so a store can call it again after a lost race.
 *
 * - An event id that was applied before is a `duplicate`.
 * - An event older than the newest one applied to its holding is `stale`: the state stays.
 * - An event that leaves its holding as it was is `unchanged`: a provider that reports one
 *   change with two events, or a failed payment for something the user never held. Its id is
 *   remembered like that of an applied one.
 * - Every other event is `applied`.
 */
export function applyEvent(
  account: BillingAccountRecord,
  event: BillingEvent,
  productType: BillingProductType,
  customerId: string | undefined,
): { outcome: ApplyOutcome; account?: BillingAccountRecord } {
  if (account.appliedEvents.includes(event.id)) return { outcome: 'duplicate' }

  const current = account.holdings.find((holding) => holding.id === event.holdingId)
  if (current && event.occurredAt.getTime() < current.updatedAt.getTime()) {
    return { outcome: 'stale' }
  }

  const next = nextHolding(current, event, productType)
  const holdings =
    next === undefined
      ? account.holdings
      : current
        ? account.holdings.map((holding) => (holding === current ? next : holding))
        : [...account.holdings, next]

  return {
    outcome: next === undefined || (current && sameState(current, next)) ? 'unchanged' : 'applied',
    account: {
      userId: account.userId,
      customerId: account.customerId ?? customerId ?? null,
      holdings,
      appliedEvents: [...account.appliedEvents, event.id],
    },
  }
}

const time = (date: Date | null): number | null => date?.getTime() ?? null

/** Whether two versions of a holding differ in nothing but `updatedAt` */
function sameState(a: BillingHolding, b: BillingHolding): boolean {
  return (
    a.product === b.product &&
    a.type === b.type &&
    a.status === b.status &&
    time(a.currentPeriodEnd) === time(b.currentPeriodEnd) &&
    time(a.accessEndsAt) === time(b.accessEndsAt)
  )
}

function nextHolding(
  current: BillingHolding | undefined,
  event: BillingEvent,
  productType: BillingProductType,
): BillingHolding | undefined {
  // A failed payment only concerns a subscription the user holds: a one-time purchase that
  // failed never became a holding, and one that completed is paid.
  if (event.type === 'payment.failed' && current?.type !== 'subscription') return undefined

  // An event for an unknown holding creates it: deliveries arrive in any order, and a refund
  // that comes before its purchase has to be there when the purchase arrives late.
  const base: BillingHolding = current ?? {
    id: event.holdingId,
    product: event.product,
    type: productType,
    status: 'active',
    startedAt: event.occurredAt,
    currentPeriodEnd: null,
    accessEndsAt: null,
    updatedAt: event.occurredAt,
  }
  const holding: BillingHolding = { ...base, updatedAt: event.occurredAt }

  switch (event.type) {
    case 'purchase.completed':
      return { ...holding, status: 'active', accessEndsAt: null }
    case 'subscription.started':
    case 'subscription.renewed':
      return {
        ...holding,
        product: event.product,
        status: 'active',
        currentPeriodEnd: event.currentPeriodEnd ?? holding.currentPeriodEnd,
        accessEndsAt: null,
      }
    case 'subscription.changed':
      // The provider says the subscription runs, with this product and period: that takes back a
      // cancel and a failed payment. A refund stays a refund until a renewal is paid again.
      return {
        ...holding,
        product: event.product,
        status: holding.status === 'refunded' ? 'refunded' : 'active',
        currentPeriodEnd: event.currentPeriodEnd ?? holding.currentPeriodEnd,
        accessEndsAt: holding.status === 'refunded' ? holding.accessEndsAt : null,
      }
    case 'subscription.canceled':
      return { ...holding, status: 'canceled', accessEndsAt: event.accessEndsAt }
    case 'payment.failed':
      // Only a paid subscription becomes past due; a canceled or refunded one stays what it is.
      return { ...holding, status: holding.status === 'active' ? 'past_due' : holding.status }
    case 'payment.refunded':
      // A second report of the same refund keeps the date of the first.
      return {
        ...holding,
        status: 'refunded',
        accessEndsAt:
          holding.status === 'refunded' && holding.accessEndsAt
            ? holding.accessEndsAt
            : event.occurredAt,
      }
  }
}
