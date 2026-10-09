---
title: Usage
description: Counted balances per subject, a budget per period and prepaid credit, spent so that a balance never goes below zero
---

# Usage

`createUsage` gives a subject a counted allowance and spends from it safely: a call either fits into what is left or is refused as a whole, and calls that arrive at the same time cannot together take more than there is. A balance comes in two kinds. A **budget** starts every period at an amount: the AI calls a plan includes per month, so that a plan can never cost more than it earns. A **prepaid** balance only changes when it is credited or spent: a pack of 100 hints that is used up one at a time.

This is not the rate limiter of `security`: that one counts requests in a short window and forgets them. Usage counts amounts, in a month or since a purchase, and what it counted survives.

A subject is a plain string id (a user, a site, a team) and the module imports no other module.

## Import

```ts
import { createUsage, createMemoryUsageStore } from '@loewen-digital/fullstack/usage'
import { createFlatdbUsageStore } from '@loewen-digital/fullstack/usage/flatdb'
```

## Setup

```ts
// src/lib/server/usage.ts
import { FsAdapter } from '@loewen-digital/flatdb'
import { createUsage } from '@loewen-digital/fullstack/usage'
import { createFlatdbUsageStore } from '@loewen-digital/fullstack/usage/flatdb'

export const usage = createUsage({
  store: createFlatdbUsageStore({ adapter: new FsAdapter('./data') }),
  balances: {
    ai: { kind: 'budget', amount: 1000 }, // per calendar month
    hints: { kind: 'prepaid' },
  },
})
```

| Option | | |
|---|---|---|
| `balances` | required | What the app counts: `{ [name]: { kind: 'budget', amount? } \| { kind: 'prepaid' } }` |
| `store` | required | Where the state is kept. There is no default: a balance in the memory of one process is lost with it |
| `keepPeriods` | default `12` | How many periods of totals are kept per balance |

`amount` of a budget may be left out when every call passes `budget` (see [The amount from a plan](#the-amount-from-a-plan)). `Infinity` is a budget without a cap.

## Spending

```ts
// src/routes/api/summarize/+server.ts
import { error, json } from '@sveltejs/kit'
import { usage } from '#lib/server/usage.js'
import type { RequestHandler } from './$types'

declare function summarize(text: string): Promise<string> // the expensive call

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)
  const userId = String(locals.authSession.userId)
  const cost = 30

  const { ok, left } = await usage.spend(userId, 'ai', cost, { tag: 'summarize' })
  if (!ok) error(402, `Not enough left this month: ${left} of ${cost}`)

  return json({ summary: await summarize(await request.text()), left })
}
```

```ts
// src/app.d.ts
import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'

declare global {
  namespace App {
    interface Locals extends FullstackLocals {}
  }
}

export {}
```

`usage.spend(subject, balance, amount, options?)` answers `{ ok, left }`:

- `ok: true`: the whole amount was taken; `left` is what remains.
- `ok: false`: it did not fit. Nothing was taken, not even the part that would have fit; `left` is what there is.

`usage.left(subject, balance, options?)` answers what is left without taking anything: one read, no write. Use it to show a balance, or to turn a user away before any work is done. It is not a reservation: between `left` and `spend` another request may spend. The amount is safe only through `spend`, so spend before the expensive work, as above, when the cost is known beforehand.

A balance name that is not in the config is a type error, and an error at run time.

## Budgets and their period

A budget renews by itself. Usage stores what was spent in a period, not what is left; the first access in a new period finds nothing spent yet. No cron job resets anything, and a subject that never comes back costs nothing.

The period is the calendar month in UTC. To let it follow a billing date, pass the date as `anchor`: every period then starts at that day of the month and time, and on the last day of a month that is too short (an anchor on the 31st gives 28 February, then 31 March).

```ts
import { createUsage, createMemoryUsageStore } from '@loewen-digital/fullstack/usage'

const metered = createUsage({
  store: createMemoryUsageStore(),
  balances: { ai: { kind: 'budget', amount: 1000 }, plan: { kind: 'budget' } },
})

async function followsTheBillingDate(userId: string, subscribedAt: Date) {
  const period = { anchor: subscribedAt }
  const left = await metered.left(userId, 'ai', period)
  const result = await metered.spend(userId, 'ai', 30, { ...period, tag: 'summarize' })
  return { left, result }
}
```

Pass the same `anchor` to `left` and `spend`. A different anchor is a different period: when a user subscribes anew, their budget starts anew with it.

### The amount from a plan

How much a budget holds usually depends on what the subject pays for. Pass it per call as `budget`; it wins over `amount` of the config. Because usage stores what was spent, a new amount counts at once: after an upgrade in the middle of a period the user has the new amount minus what they already spent, and after a downgrade below that, nothing, never less.

```ts
async function fromThePlan(userId: string, limitOfThePlan: number) {
  // limitOfThePlan: (await billing.entitlements(userId)).limit('ai')
  return metered.spend(userId, 'plan', 30, { budget: limitOfThePlan })
}
```

## Prepaid balances

A prepaid balance starts at 0 and never renews. `usage.credit(subject, balance, amount, { key })` adds to it **once per key**: with the id of the purchase event as key, an event the provider delivers twice credits once. It answers `{ applied, left }`, with `applied: false` for a key that was credited before.

```ts
import type { BillingEvent } from '@loewen-digital/fullstack/billing'

const game = createUsage({
  store: createMemoryUsageStore(),
  balances: { hints: { kind: 'prepaid' } },
})

// With `events` of `billing.handleWebhook(request)`:
async function creditPurchases(events: BillingEvent[]) {
  for (const event of events) {
    if (event.type === 'purchase.completed' && event.product === 'hints100') {
      await game.credit(event.userId, 'hints', 100, { key: event.id })
    }
  }
}

async function useHint(userId: string) {
  const { ok } = await game.spend(userId, 'hints', 1, { tag: 'hint' })
  return ok
}
```

The key makes the credit safe to repeat, which is what [billing asks of a side effect](/modules/billing#events) that must not be lost: run it for the `duplicate` entries of `handleWebhook` as well, and a delivery that failed after billing stored the purchase still credits. Only a prepaid balance is credited; a credit to a budget is a type error.

To give back what a failed call spent from a prepaid balance, credit it with a key of your own (the id of the job). A budget has no way back.

## Totals

Every spend can carry a `tag`. `usage.totals(subject, balance)` answers what the subject spent, per period and tag, newest period first:

```ts
async function report(userId: string) {
  const [current] = await metered.totals(userId, 'ai')
  // { start: Date, end: Date, spent: 45, tags: { summarize: 15, translate: 20 } }
  return current?.tags.summarize ?? 0
}
```

`spent` is everything, tagged or not. A period without a spend is not in the list. Spends from a prepaid balance are added up per calendar month. The newest `keepPeriods` periods are kept.

Tags are for a small, fixed set of names your code chooses. Never pass user input as a tag: every distinct tag is kept in the subject's record.

## Amounts

Amounts are whole numbers, 0 or more; anything else throws. With fractions, "is there enough left" would become a matter of rounding. Choose the unit so that the smallest thing you count is 1:

- **Money**: count cents (or the smallest unit of the currency), never 0.30. A budget of 5.00 is `500`.
- **Fractions of a cent**, as AI providers charge them: count thousandths of a cent or micro-dollars, and round a cost **up** before you spend it, so the sum of what was spent is never below what you pay.
- **Units** (calls, hints, tokens): count them as they are.

Amounts stay exact up to `Number.MAX_SAFE_INTEGER`, about 9 × 10¹⁵; a credit that would go beyond throws.

## Stores

| Store | | Holds its guarantee across |
|---|---|---|
| `createMemoryUsageStore()` | Development and tests. Gone with the process | One process |
| `createFlatdbUsageStore({ adapter, prefix? })` | One JSON file per subject on the storage adapter your `flatdb()` runs on | What the adapter coordinates, see below |

The flatdb store writes `usage/<subject>.json` with the adapter's compare-and-swap (`readVersioned` and `writeIf`): a spend reads the record, decides, and writes only if nobody wrote in between; otherwise it reads again and decides again, twenty times at most, then it throws. That is what keeps two calls from spending the same units. An adapter without the pair is refused when the store is created; it needs `@loewen-digital/flatdb` 0.3 or later. A store that cannot hold the guarantee does not ship, which is why there is none for Workers KV.

- **`R2Adapter`**: the swap is on the object's etag and holds across every Worker request and isolate. Build adapter, store and usage per request from `platform.env`. A spend is one read and one conditional write to R2: fine next to a call that takes seconds, slow for counting something a subject does many times a second.
- **`FsAdapter`**: holds within one process. Two processes on one folder are not coordinated.
- **`prefix`** (default `usage`) is a folder below the adapter's root. Do not name a collection the same.
- A file that is not a usage record is refused; the store never guesses a balance.

### Your own store

```ts
import type { UsageRecord, UsageStore } from '@loewen-digital/fullstack/usage'

const records = new Map<string, UsageRecord>()

const ownStore: UsageStore = {
  async read(subject) {
    return records.get(subject) ?? null
  },
  async transact(subject, change) {
    const current = records.get(subject) ?? { subject, balances: {} }
    const { record, result } = change(current)
    if (record) records.set(subject, record)
    return result
  },
}
```

`transact` carries the guarantee: read the record, call `change`, store what it returns, and let no concurrent `transact` for the same subject slip in between. On SQL that is a transaction with a row lock, or a version column that the `UPDATE` checks. `change` is free of side effects, so call it again on the fresh record after a lost race; when it returns no `record`, write nothing. A record is plain JSON.

## What it does not do

- **No log of single spends.** Usage keeps sums per period and tag. Which call spent what, and when, is for your own log.
- **No totals across subjects.** `totals` answers for one subject; what all users spent this month is not a question this module answers.
- **No key for a spend.** A spend that is repeated after a timeout spends twice. Only credits are applied once per key.
- **No prices.** What a call costs is yours to compute; usage counts what you tell it. It reports nothing to a payment provider.
- **No rate limiting.** That is `createRateLimiter` in [security](/modules/security).
