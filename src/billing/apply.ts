import type {
  BillingAccountRecord,
  BillingEvent,
  BillingHolding,
  BillingProductType,
} from './types.js'

export type ApplyOutcome = 'applied' | 'unchanged' | 'duplicate' | 'stale'

/** The account of a user no event was applied for yet */
export function emptyAccount(userId: string): BillingAccountRecord {
  return { userId, customers: {}, holdings: [], grants: [], appliedEvents: [] }
}

/**
 * A provider's id behind the name of its provider. Provider names have no `:`, so the ids of two
 * providers never meet: in the links of a store and in the applied events of an account.
 */
export function scopedId(provider: string, id: string): string {
  return `${provider}:${id}`
}

/**
 * Applies one event to an account and says what came of it. Pure: the account handed in is not
 * touched, so a store can call it again after a lost race.
 *
 * - An event id that was applied before is a `duplicate`. Ids count per provider, like holdings:
 *   the same id from two providers is two events, and two holdings.
 * - An event older than the newest one applied to its holding is `stale`: the state stays.
 * - An event that leaves its holding as it was is `unchanged`: a provider that reports one
 *   change with two events, or a failed payment for something the user never held. Its id is
 *   remembered like that of an applied one.
 * - Every other event is `applied`.
 * - An event that names the holding its own takes the place of ends that holding, in the same
 *   step.
 */
export function applyEvent(
  account: BillingAccountRecord,
  event: BillingEvent,
  productType: BillingProductType,
  customerId: string | undefined,
): { outcome: ApplyOutcome; account?: BillingAccountRecord } {
  const eventKey = scopedId(event.provider, event.id)
  if (account.appliedEvents.includes(eventKey)) return { outcome: 'duplicate' }

  const current = account.holdings.find(
    (holding) => holding.provider === event.provider && holding.id === event.holdingId,
  )
  if (current && event.occurredAt.getTime() < current.updatedAt.getTime()) {
    return { outcome: 'stale' }
  }

  const changed = nextHolding(current, event, productType)
  // Past due since the first failed payment, for as long as the holding stays past due.
  const next = changed && {
    ...changed,
    pastDueSince:
      changed.status === 'past_due' ? (current?.pastDueSince ?? event.occurredAt) : null,
  }
  const kept =
    next === undefined
      ? account.holdings
      : current
        ? account.holdings.map((holding) => (holding === current ? next : holding))
        : [...account.holdings, next]
  // The purchase this one takes the place of is over with it.
  const replaced = next === undefined ? undefined : replacedBy(kept, event)
  const holdings = replaced
    ? kept.map((holding) => (holding === replaced.holding ? replaced.ended : holding))
    : kept

  return {
    outcome:
      !replaced && (next === undefined || (current && sameState(current, next)))
        ? 'unchanged'
        : 'applied',
    // Everything else on the account stays, above all what was granted by hand.
    account: {
      ...account,
      // The first customer a provider names for the user stays.
      customers:
        customerId === undefined || Object.hasOwn(account.customers, event.provider)
          ? account.customers
          : { ...account.customers, [event.provider]: customerId },
      holdings,
      appliedEvents: [...account.appliedEvents, eventKey],
    },
  }
}

const time = (date: Date | null): number | null => date?.getTime() ?? null

/**
 * The holding an event takes the place of, and what becomes of it: the provider booked a change
 * of plan as a new purchase, so the old one ends at the moment of the event. `undefined` when
 * there is nothing to end: the event names none, the account has no such holding, or that
 * holding is over already or newer than the event.
 */
function replacedBy(
  holdings: BillingHolding[],
  event: BillingEvent,
): { holding: BillingHolding; ended: BillingHolding } | undefined {
  if (event.replacesHoldingId === undefined || event.replacesHoldingId === event.holdingId) {
    return undefined
  }
  const at = event.occurredAt.getTime()
  const holding = holdings.find(
    (entry) => entry.provider === event.provider && entry.id === event.replacesHoldingId,
  )
  if (!holding || at < holding.updatedAt.getTime()) return undefined
  const runs =
    holding.status === 'active' ||
    holding.status === 'past_due' ||
    (holding.status === 'canceled' && (time(holding.accessEndsAt) ?? 0) > at)
  if (!runs) return undefined
  return {
    holding,
    ended: {
      ...holding,
      status: 'canceled',
      accessEndsAt: event.occurredAt,
      pastDueSince: null,
      updatedAt: event.occurredAt,
    },
  }
}

/** Whether two versions of a holding differ in nothing but `updatedAt` */
function sameState(a: BillingHolding, b: BillingHolding): boolean {
  return (
    a.provider === b.provider &&
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
    provider: event.provider,
    id: event.holdingId,
    product: event.product,
    type: productType,
    status: 'active',
    startedAt: event.occurredAt,
    currentPeriodEnd: null,
    accessEndsAt: null,
    pastDueSince: null,
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
