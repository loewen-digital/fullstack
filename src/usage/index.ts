import { balanceOf, credit, periodOf, spend, spentIn } from './apply.js'
import { UsageError } from './errors.js'
import type {
  UsageBalanceConfig,
  UsageBalances,
  UsageBudgetOptions,
  UsageConfig,
  UsageInstance,
} from './types.js'

export type {
  UsageBalanceConfig,
  UsageBalanceRecord,
  UsageBalances,
  UsageBudgetOptions,
  UsageConfig,
  UsageCreditResult,
  UsageInstance,
  UsagePeriodRecord,
  UsagePrepaidName,
  UsageRecord,
  UsageSpendOptions,
  UsageSpendResult,
  UsageStore,
  UsageTotals,
} from './types.js'
export { UsageError } from './errors.js'
export { createMemoryUsageStore } from './stores/memory.js'

/**
 * Create a usage instance: counted allowances per subject that are spent safely. A call either
 * fits into what is left or is refused as a whole, and a balance never goes below zero.
 *
 * Usage:
 *   const usage = createUsage({
 *     store: createMemoryUsageStore(),
 *     balances: {
 *       ai: { kind: 'budget', amount: 1000 }, // per calendar month
 *       packs: { kind: 'prepaid' },
 *     },
 *   })
 *
 *   const { ok, left } = await usage.spend(userId, 'ai', 30, { tag: 'summarize' })
 *   await usage.credit(userId, 'packs', 100, { key: event.id })
 *
 * A subject is a plain string id (a user, a site, a team). Amounts are whole numbers in a unit
 * of your choice. The module imports no other module.
 */
export function createUsage<const B extends UsageBalances>(
  config: UsageConfig<B>,
): UsageInstance<B> {
  const { store } = config
  const balances: UsageBalances = config.balances
  const keep = config.keepPeriods ?? 12
  if (!Number.isSafeInteger(keep) || keep < 1) {
    throw new UsageError('usage: `keepPeriods` must be a whole number, 1 or more.')
  }
  for (const [name, balance] of Object.entries(balances)) {
    if (balance.kind !== 'budget' && balance.kind !== 'prepaid') {
      throw new UsageError(`usage: balance "${name}" needs the kind "budget" or "prepaid".`)
    }
    if (balance.kind === 'budget' && balance.amount !== undefined) {
      requireBudget(balance.amount, `\`amount\` of balance "${name}"`)
    }
  }

  function configOf(name: string): UsageBalanceConfig {
    if (!Object.hasOwn(balances, name)) throw new UsageError(`usage: unknown balance "${name}"`)
    return balances[name]!
  }

  /** How much a budget holds for this call; `undefined` for a prepaid balance */
  function budgetOf(name: string, options: UsageBudgetOptions): number | undefined {
    const balance = configOf(name)
    if (balance.kind === 'prepaid') return undefined
    const budget = options.budget ?? balance.amount
    if (budget === undefined) {
      throw new UsageError(
        `usage: budget "${name}" has no amount: set \`amount\` in the config or pass \`budget\`.`,
      )
    }
    return requireBudget(budget, '`budget`')
  }

  function periodFor(options: UsageBudgetOptions): { start: string; end: string } {
    for (const [name, value] of [
      ['now', options.now],
      ['anchor', options.anchor],
    ] as const) {
      if (value !== undefined && Number.isNaN(value.getTime())) {
        throw new UsageError(`usage: \`${name}\` is not a valid date.`)
      }
    }
    return periodOf(options.now ?? new Date(), options.anchor)
  }

  return {
    async left(subject, name, options = {}) {
      requireSubject(subject)
      const budget = budgetOf(name, options)
      const period = periodFor(options)
      const balance = balanceOf(await store.read(subject), name)
      return budget === undefined
        ? balance.balance
        : Math.max(0, budget - spentIn(balance, period.start))
    },

    async spend(subject, name, amount, options = {}) {
      requireSubject(subject)
      requireAmount(amount)
      const { tag } = options
      if (tag !== undefined && (typeof tag !== 'string' || tag === '' || tag.length > 64)) {
        throw new UsageError('usage: `tag` must be a string of 1 to 64 characters.')
      }
      const budget = budgetOf(name, options)
      const period = periodFor(options)
      return store.transact(subject, (record) =>
        spend(record, { name, amount, budget, period, tag, keep }),
      )
    },

    async credit(subject, name, amount, options) {
      requireSubject(subject)
      requireAmount(amount)
      if (configOf(name).kind !== 'prepaid') {
        throw new UsageError(
          `usage: "${name}" is a budget; only a prepaid balance is credited. A budget starts each period at its amount.`,
        )
      }
      const key = options?.key
      if (typeof key !== 'string' || key === '') {
        throw new UsageError('usage: a credit needs a `key`, so that it is applied once.')
      }
      return store.transact(subject, (record) => credit(record, name, amount, key))
    },

    async totals(subject, name) {
      requireSubject(subject)
      configOf(name)
      return balanceOf(await store.read(subject), name)
        .periods.map((period) => ({
          start: new Date(period.start),
          end: new Date(period.end),
          spent: period.spent,
          tags: { ...period.tags },
        }))
        .reverse()
    },
  }
}

function requireSubject(subject: string): void {
  if (typeof subject !== 'string' || subject === '') {
    throw new UsageError('usage: the subject must be a non-empty string')
  }
}

/** Amounts are whole numbers: a fraction would make "is there enough left" a matter of rounding */
function requireAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new UsageError(
      `usage: an amount must be a whole number, 0 or more; got ${String(amount)}. Count in the smallest unit you need (cents, thousandths).`,
    )
  }
}

function requireBudget(budget: number, what: string): number {
  if (budget !== Infinity && (!Number.isSafeInteger(budget) || budget < 0)) {
    throw new UsageError(`usage: ${what} must be a whole number, 0 or more, or Infinity.`)
  }
  return budget
}
