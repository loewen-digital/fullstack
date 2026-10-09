/**
 * A counted allowance, declared once under a name of your choice.
 *
 * - `budget`: starts every period at `amount`; what is not spent does not carry over.
 * - `prepaid`: only changes when it is credited or spent, and never runs out by itself.
 */
export type UsageBalanceConfig =
  | {
      kind: 'budget'
      /**
       * What a subject may spend per period. Leave it out when every call passes `budget`
       * (the amount depends on the subject's plan). `Infinity` for no cap.
       */
      amount?: number
    }
  | { kind: 'prepaid' }

export type UsageBalances = Record<string, UsageBalanceConfig>

/** What one subject spent from one balance in one period */
export interface UsagePeriodRecord {
  /** The start of the period, ISO 8601; a period is identified by it */
  start: string
  /** The start of the next period, ISO 8601 */
  end: string
  /** Everything spent in the period, tagged or not */
  spent: number
  /** The part of `spent` that carried a tag, by tag */
  tags: Record<string, number>
}

/** One balance of one subject as a store keeps it */
export interface UsageBalanceRecord {
  /** Prepaid: what is left. Budget: unused, `0` */
  balance: number
  /** Prepaid: the keys of the credits already applied */
  credits: string[]
  /** What was spent, per period, oldest first; the newest `keepPeriods` are kept */
  periods: UsagePeriodRecord[]
}

/** Everything usage keeps for one subject: plain JSON, no dates, no methods */
export interface UsageRecord {
  subject: string
  balances: Record<string, UsageBalanceRecord>
}

/**
 * Where usage keeps its state. `transact` carries the guarantee: calls that spend at the same
 * time cannot together spend more than there is.
 */
export interface UsageStore {
  /** The record of a subject, or `null` when nothing was ever spent or credited for it */
  read(subject: string): Promise<UsageRecord | null>
  /**
   * Reads the record (an empty one for an unknown subject), calls `change` and stores the record
   * it returns, as one atomic step. A store that lost a race calls `change` again on the fresh
   * record, so `change` must be free of side effects. Without `record` in the answer nothing is
   * written.
   */
  transact<R>(
    subject: string,
    change: (record: UsageRecord) => { record?: UsageRecord; result: R },
  ): Promise<R>
}

export interface UsageConfig<B extends UsageBalances = UsageBalances> {
  /** The balances the app counts, by a name of your choice */
  balances: B
  /** Where the state is kept: `createMemoryUsageStore()`, `createFlatdbUsageStore()`, your own */
  store: UsageStore
  /** How many periods of totals are kept per balance (default: 12) */
  keepPeriods?: number
}

/** What says how much a budget holds and when its period starts; ignored by a prepaid balance */
export interface UsageBudgetOptions {
  /**
   * What the subject may spend per period, instead of `amount` of the config: the place for a
   * limit that comes from the subject's plan. `Infinity` for no cap.
   */
  budget?: number
  /**
   * A date the periods follow, such as the start of a subscription: every period starts at
   * this day of the month and time (UTC), on the last day of a shorter month. Left out: the
   * calendar month, UTC.
   */
  anchor?: Date
  /** The present, for tests */
  now?: Date
}

export interface UsageSpendOptions extends UsageBudgetOptions {
  /** What the amount was spent on (`'summarize'`); `totals` adds up per tag. Use a small, fixed set */
  tag?: string
}

export interface UsageSpendResult {
  /** `true`: the whole amount was taken. `false`: it did not fit, and nothing was taken */
  ok: boolean
  /** What is left after the call */
  left: number
}

export interface UsageCreditResult {
  /** `false` when this key was credited before; the balance did not change then */
  applied: boolean
  /** What is left after the call */
  left: number
}

/** What a subject spent from a balance in one period */
export interface UsageTotals {
  start: Date
  end: Date
  spent: number
  tags: Record<string, number>
}

/** The names of the prepaid balances of a config */
export type UsagePrepaidName<B extends UsageBalances> = string extends keyof B
  ? string
  : {
      [K in keyof B]: B[K] extends { kind: 'prepaid' } ? K : never
    }[keyof B] &
      string

export interface UsageInstance<B extends UsageBalances = UsageBalances> {
  /** What a subject has left of a balance right now. One read, no write */
  left(subject: string, balance: keyof B & string, options?: UsageBudgetOptions): Promise<number>
  /**
   * Takes `amount` from a balance when all of it fits into what is left, and nothing otherwise.
   * Calls at the same time cannot together take more than there is.
   */
  spend(
    subject: string,
    balance: keyof B & string,
    amount: number,
    options?: UsageSpendOptions,
  ): Promise<UsageSpendResult>
  /**
   * Adds `amount` to a prepaid balance, once per `key`: a purchase event delivered twice
   * credits once.
   */
  credit(
    subject: string,
    balance: UsagePrepaidName<B>,
    amount: number,
    options: { key: string },
  ): Promise<UsageCreditResult>
  /** What a subject spent from a balance, per period and tag, newest period first */
  totals(subject: string, balance: keyof B & string): Promise<UsageTotals[]>
}
