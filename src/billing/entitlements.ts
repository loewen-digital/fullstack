import { BillingError } from './errors.js'
import type {
  BillingAccount,
  BillingEntitlementSet,
  BillingEntitlements,
  BillingEntitlementsConfig,
  BillingHolding,
  BillingProducts,
} from './types.js'

const DAY = 86_400_000

/** Refuses a config whose answer could not be trusted: a grace period or a limit that is no number */
export function checkEntitlementsConfig(
  products: BillingProducts,
  config: BillingEntitlementsConfig,
): void {
  const grace = config.pastDueGraceDays
  if (grace !== undefined && !(typeof grace === 'number' && grace >= 0)) {
    throw new BillingError(
      'billing: `entitlements.pastDueGraceDays` must be a number of days, 0 or more.',
    )
  }
  const sets: [string, BillingEntitlementSet | undefined][] = [
    ['the default', config.default],
    ...Object.entries(products).map(([key, product]): [string, BillingEntitlementSet] => [
      `product "${key}"`,
      product,
    ]),
  ]
  for (const [where, set] of sets) {
    for (const [name, value] of Object.entries(set?.limits ?? {})) {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new BillingError(`billing: the limit "${name}" of ${where} is not a number.`)
      }
    }
  }
}

/**
 * Whether a holding gives its product at `now`.
 *
 * - `active`: yes. A one-time purchase stays active, so it grants for good.
 * - `canceled`: until `accessEndsAt`, the end of what was paid for.
 * - `past_due`: for as long as the provider keeps trying, or for `graceDays` after the first
 *   failed payment when the config sets them.
 * - `refunded`: no.
 */
export function holdingGrants(
  holding: BillingHolding,
  now: Date,
  graceDays: number | undefined,
): boolean {
  switch (holding.status) {
    case 'active':
      return true
    case 'canceled':
      return holding.accessEndsAt !== null && now.getTime() < holding.accessEndsAt.getTime()
    case 'past_due': {
      if (graceDays === undefined) return true
      const since = holding.pastDueSince ?? holding.updatedAt
      return now.getTime() < since.getTime() + graceDays * DAY
    }
    case 'refunded':
      return false
  }
}

/**
 * What a user may use at `now`, from the account billing keeps for them. Pure: no store, no
 * provider. Features add up; of a limit the highest value counts.
 */
export function resolveEntitlements(
  userId: string,
  account: BillingAccount | null,
  products: BillingProducts,
  config: BillingEntitlementsConfig,
  now: Date,
): BillingEntitlements {
  const granting = new Set<string>()
  for (const holding of account?.holdings ?? []) {
    if (holdingGrants(holding, now, config.pastDueGraceDays)) granting.add(holding.product)
  }
  for (const grant of account?.grants ?? []) {
    if (grant.until === null || now.getTime() < grant.until.getTime()) granting.add(grant.product)
  }
  // In the order of the config, and only what the config still knows.
  const held = Object.keys(products).filter((key) => granting.has(key))

  const features = new Set<string>()
  const limits: Record<string, number> = {}
  for (const set of [config.default, ...Object.values(products)]) {
    for (const name of Object.keys(set?.limits ?? {})) limits[name] = 0
  }
  for (const set of [config.default, ...held.map((key) => products[key])]) {
    for (const feature of set?.features ?? []) features.add(feature)
    for (const [name, value] of Object.entries(set?.limits ?? {})) {
      limits[name] = Math.max(limits[name] ?? 0, value)
    }
  }

  return {
    userId,
    products: held,
    features: [...features],
    limits,
    has: (feature) => features.has(feature),
    limit: (name) => limits[name] ?? 0,
  }
}
