import { UsageError } from './errors.js'
import type { UsageBalanceRecord, UsagePeriodRecord, UsageRecord } from './types.js'

/** The record of a subject nothing was spent or credited for yet */
export function emptyRecord(subject: string): UsageRecord {
  return { subject, balances: {} }
}

const EMPTY: UsageBalanceRecord = { balance: 0, credits: [], periods: [] }

/** The balance of a record by name; names are data, so never a property of `Object.prototype` */
export function balanceOf(record: UsageRecord | null, name: string): UsageBalanceRecord {
  return record && Object.hasOwn(record.balances, name) ? record.balances[name]! : EMPTY
}

function withBalance(record: UsageRecord, name: string, balance: UsageBalanceRecord): UsageRecord {
  return { ...record, balances: { ...record.balances, [name]: balance } }
}

/** `anchor` moved by whole months (UTC), on the last day of a month that is too short for its day */
function addMonths(anchor: Date, months: number): Date {
  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + months, 1) +
      (anchor.getTime() % 86_400_000),
  )
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate()
  first.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
  return first
}

const CALENDAR = new Date(0)

/**
 * The period `now` falls into: a month that starts at the anchor's day and time, or the
 * calendar month (UTC) without an anchor. Every period is counted from the anchor itself, so
 * an anchor on the 31st stays on the 31st after a February.
 */
export function periodOf(now: Date, anchor: Date = CALENDAR): { start: string; end: string } {
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth())
  if (addMonths(anchor, months).getTime() > now.getTime()) months--
  return {
    start: addMonths(anchor, months).toISOString(),
    end: addMonths(anchor, months + 1).toISOString(),
  }
}

/** What was spent from a balance in the period that starts at `start` */
export function spentIn(balance: UsageBalanceRecord, start: string): number {
  return balance.periods.find((period) => period.start === start)?.spent ?? 0
}

function addToPeriod(
  balance: UsageBalanceRecord,
  period: { start: string; end: string },
  amount: number,
  tag: string | undefined,
  keep: number,
): UsagePeriodRecord[] {
  const current = balance.periods.find((entry) => entry.start === period.start) ?? {
    ...period,
    spent: 0,
    tags: {},
  }
  const tagged = tag !== undefined && Object.hasOwn(current.tags, tag) ? current.tags[tag]! : 0
  const next: UsagePeriodRecord = {
    ...current,
    spent: sum(current.spent, amount),
    tags: tag === undefined ? current.tags : { ...current.tags, [tag]: sum(tagged, amount) },
  }
  return [...balance.periods.filter((entry) => entry.start !== period.start), next]
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .slice(-keep)
}

function sum(a: number, b: number): number {
  const total = a + b
  if (!Number.isSafeInteger(total)) {
    throw new UsageError('usage: the amount is too large to be counted exactly.')
  }
  return total
}

export interface SpendInput {
  name: string
  amount: number
  /** `undefined` for a prepaid balance */
  budget: number | undefined
  period: { start: string; end: string }
  tag: string | undefined
  keep: number
}

/**
 * Takes an amount from a balance, or refuses. Pure: the record handed in is not touched, so a
 * store can call it again after a lost race. A refusal and an amount of 0 write nothing.
 */
export function spend(
  record: UsageRecord,
  input: SpendInput,
): { record?: UsageRecord; result: { ok: boolean; left: number } } {
  const balance = balanceOf(record, input.name)
  const available =
    input.budget === undefined
      ? balance.balance
      : Math.max(0, input.budget - spentIn(balance, input.period.start))
  if (input.amount > available) return { result: { ok: false, left: available } }
  if (input.amount === 0) return { result: { ok: true, left: available } }

  return {
    record: withBalance(record, input.name, {
      ...balance,
      balance: input.budget === undefined ? balance.balance - input.amount : balance.balance,
      periods: addToPeriod(balance, input.period, input.amount, input.tag, input.keep),
    }),
    result: { ok: true, left: available - input.amount },
  }
}

/** Adds an amount to a prepaid balance, once per key. Pure, like `spend` */
export function credit(
  record: UsageRecord,
  name: string,
  amount: number,
  key: string,
): { record?: UsageRecord; result: { applied: boolean; left: number } } {
  const balance = balanceOf(record, name)
  if (balance.credits.includes(key)) return { result: { applied: false, left: balance.balance } }
  const left = sum(balance.balance, amount)
  return {
    record: withBalance(record, name, {
      ...balance,
      balance: left,
      credits: [...balance.credits, key],
    }),
    result: { applied: true, left },
  }
}
