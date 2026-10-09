import { afterAll, describe, it, expect, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsAdapter, MemoryAdapter } from '@loewen-digital/flatdb'
import { UsageError, createMemoryUsageStore, createUsage } from '../index.js'
import type { UsageInstance, UsageStore } from '../index.js'
import { createFlatdbUsageStore } from '../stores/flatdb.js'
import { periodOf } from '../apply.js'

const balances = {
  ai: { kind: 'budget', amount: 100 },
  plan: { kind: 'budget' },
  packs: { kind: 'prepaid' },
} as const

const utc = (iso: string): Date => new Date(`${iso}Z`)

const tmpDirs: string[] = []
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const stores: [string, () => Promise<UsageStore>][] = [
  ['memory store', async () => createMemoryUsageStore()],
  [
    'flatdb store on MemoryAdapter',
    async () => createFlatdbUsageStore({ adapter: new MemoryAdapter() }),
  ],
  [
    'flatdb store on FsAdapter',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fullstack-usage-'))
      tmpDirs.push(dir)
      return createFlatdbUsageStore({ adapter: new FsAdapter(dir) })
    },
  ],
]

describe.each(stores)('usage on the %s', (_name, createStore) => {
  async function setup(keepPeriods?: number) {
    const store = await createStore()
    return { usage: createUsage({ store, balances, keepPeriods }), store }
  }

  const october = { now: utc('2026-10-09T12:00:00') }

  it('starts a budget at its amount and a prepaid balance at nothing', async () => {
    const { usage } = await setup()

    expect(await usage.left('u1', 'ai', october)).toBe(100)
    expect(await usage.left('u1', 'packs')).toBe(0)
    expect(await usage.totals('u1', 'ai')).toEqual([])
  })

  it('spends from a budget and refuses as a whole what does not fit', async () => {
    const { usage } = await setup()

    expect(await usage.spend('u1', 'ai', 30, october)).toEqual({ ok: true, left: 70 })
    expect(await usage.spend('u1', 'ai', 70, october)).toEqual({ ok: true, left: 0 })
    // One unit too many: nothing is taken, not even the part that would fit.
    expect(await usage.spend('u1', 'ai', 1, october)).toEqual({ ok: false, left: 0 })
    expect(await usage.left('u1', 'ai', october)).toBe(0)

    expect(await usage.spend('u2', 'ai', 101, october)).toEqual({ ok: false, left: 100 })
    expect(await usage.left('u2', 'ai', october)).toBe(100)
    expect(await usage.totals('u2', 'ai')).toEqual([])
  })

  it('spends from a prepaid balance only what was credited', async () => {
    const { usage } = await setup()

    expect(await usage.spend('u1', 'packs', 1)).toEqual({ ok: false, left: 0 })
    expect(await usage.credit('u1', 'packs', 10, { key: 'evt_1' })).toEqual({
      applied: true,
      left: 10,
    })
    expect(await usage.spend('u1', 'packs', 4)).toEqual({ ok: true, left: 6 })
    expect(await usage.spend('u1', 'packs', 7)).toEqual({ ok: false, left: 6 })
    expect(await usage.spend('u1', 'packs', 6)).toEqual({ ok: true, left: 0 })
    expect(await usage.left('u1', 'packs')).toBe(0)
    // Another subject has a balance of its own.
    expect(await usage.left('u2', 'packs')).toBe(0)
  })

  it('never lets calls at the same time spend more than a budget holds', async () => {
    const { usage } = await setup()

    const results = await Promise.all(
      Array.from({ length: 40 }, () => usage.spend('u1', 'ai', 5, october)),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(20)
    expect(await usage.left('u1', 'ai', october)).toBe(0)
    expect((await usage.totals('u1', 'ai'))[0]?.spent).toBe(100)
  })

  it('never lets calls at the same time spend more than a prepaid balance holds', async () => {
    const { usage } = await setup()
    await usage.credit('u1', 'packs', 7, { key: 'evt_1' })

    const results = await Promise.all(
      Array.from({ length: 25 }, () => usage.spend('u1', 'packs', 1)),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(7)
    expect(results.every((result) => result.left >= 0)).toBe(true)
    expect(await usage.left('u1', 'packs')).toBe(0)
  })

  it('credits once per key, also when the same key arrives many times at once', async () => {
    const { usage } = await setup()

    const results = await Promise.all(
      Array.from({ length: 20 }, () => usage.credit('u1', 'packs', 50, { key: 'evt_purchase' })),
    )
    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(await usage.left('u1', 'packs')).toBe(50)

    expect(await usage.credit('u1', 'packs', 50, { key: 'evt_purchase' })).toEqual({
      applied: false,
      left: 50,
    })
    expect(await usage.credit('u1', 'packs', 5, { key: 'evt_other' })).toEqual({
      applied: true,
      left: 55,
    })
  })

  it('keeps every credit and every spend that arrive at the same moment', async () => {
    const { usage } = await setup()
    await usage.credit('u1', 'packs', 100, { key: 'start' })

    await Promise.all([
      ...Array.from({ length: 10 }, (_, index) =>
        usage.credit('u1', 'packs', 10, { key: `evt_${index}` }),
      ),
      ...Array.from({ length: 10 }, () => usage.spend('u1', 'packs', 3)),
      ...Array.from({ length: 10 }, () => usage.spend('u1', 'ai', 2, october)),
    ])

    expect(await usage.left('u1', 'packs')).toBe(100 + 100 - 30)
    expect(await usage.left('u1', 'ai', october)).toBe(80)
  })

  it('starts a budget again in a new calendar month, on the first access and without a job', async () => {
    const { usage } = await setup()
    await usage.spend('u1', 'ai', 90, { now: utc('2026-10-31T23:59:59') })
    expect(await usage.left('u1', 'ai', { now: utc('2026-10-31T23:59:59') })).toBe(10)

    expect(await usage.left('u1', 'ai', { now: utc('2026-11-01T00:00:00') })).toBe(100)
    expect(await usage.spend('u1', 'ai', 60, { now: utc('2026-11-01T00:00:00') })).toEqual({
      ok: true,
      left: 40,
    })

    // What was left in October is gone, and October's total stays readable.
    expect(await usage.totals('u1', 'ai')).toEqual([
      { start: utc('2026-11-01T00:00:00'), end: utc('2026-12-01T00:00:00'), spent: 60, tags: {} },
      { start: utc('2026-10-01T00:00:00'), end: utc('2026-11-01T00:00:00'), spent: 90, tags: {} },
    ])
  })

  it('lets the period follow a date the app supplies', async () => {
    const { usage } = await setup()
    const anchor = utc('2026-01-17T08:30:00') // the day and time a subscription started

    await usage.spend('u1', 'ai', 80, { anchor, now: utc('2026-10-17T08:29:59') })
    expect(await usage.left('u1', 'ai', { anchor, now: utc('2026-10-17T08:29:59') })).toBe(20)
    // The billing date passed: a new period, although the calendar month is the same.
    expect(await usage.left('u1', 'ai', { anchor, now: utc('2026-10-17T08:30:00') })).toBe(100)

    await usage.spend('u1', 'ai', 5, { anchor, now: utc('2026-10-20T00:00:00') })
    expect((await usage.totals('u1', 'ai')).map((period) => [period.start, period.spent])).toEqual([
      [utc('2026-10-17T08:30:00'), 5],
      [utc('2026-09-17T08:30:00'), 80],
    ])
  })

  it('takes the amount of a budget per call, for a limit that comes from a plan', async () => {
    const { usage } = await setup()

    expect(await usage.left('u1', 'plan', { ...october, budget: 500 })).toBe(500)
    await usage.spend('u1', 'plan', 300, { ...october, budget: 500 })

    // An upgrade in the middle of the period counts at once, with what was spent already.
    expect(await usage.left('u1', 'plan', { ...october, budget: 2000 })).toBe(1700)
    // A downgrade below what was spent leaves nothing, and never less than nothing.
    expect(await usage.left('u1', 'plan', { ...october, budget: 100 })).toBe(0)
    expect(await usage.spend('u1', 'plan', 1, { ...october, budget: 100 })).toEqual({
      ok: false,
      left: 0,
    })
    // No cap.
    expect(await usage.spend('u1', 'plan', 1_000_000, { ...october, budget: Infinity })).toEqual({
      ok: true,
      left: Infinity,
    })
    // The amount of the config is the fallback, and `budget` wins over it.
    expect(await usage.left('u1', 'ai', { ...october, budget: 7 })).toBe(7)
  })

  it('adds up what was spent per tag and period', async () => {
    const { usage } = await setup()

    await usage.spend('u1', 'ai', 10, { ...october, tag: 'summarize' })
    await usage.spend('u1', 'ai', 5, { ...october, tag: 'summarize' })
    await usage.spend('u1', 'ai', 20, { ...october, tag: 'translate' })
    await usage.spend('u1', 'ai', 1, october)
    // Names that are properties of every object are tags like any other.
    await usage.spend('u1', 'ai', 2, { ...october, tag: 'constructor' })
    await usage.spend('u1', 'ai', 3, { ...october, tag: '__proto__' })
    await usage.spend('u1', 'ai', 4, { ...october, tag: '__proto__' })
    await usage.spend('u1', 'ai', 9, { now: utc('2026-11-02T00:00:00'), tag: 'summarize' })
    await usage.spend('u2', 'ai', 50, { ...october, tag: 'summarize' })

    const [november, octoberTotals] = await usage.totals('u1', 'ai')
    expect(november).toMatchObject({ spent: 9, tags: { summarize: 9 } })
    expect(octoberTotals!.spent).toBe(45)
    expect(Object.entries(octoberTotals!.tags).sort(([a], [b]) => (a < b ? -1 : 1))).toEqual([
      ['__proto__', 7],
      ['constructor', 2],
      ['summarize', 15],
      ['translate', 20],
    ])
  })

  it('adds up what was spent from a prepaid balance per calendar month', async () => {
    const { usage } = await setup()
    await usage.credit('u1', 'packs', 100, { key: 'evt_1' })

    await usage.spend('u1', 'packs', 3, { now: utc('2026-10-09T00:00:00'), tag: 'level' })
    await usage.spend('u1', 'packs', 4, { now: utc('2026-11-09T00:00:00'), tag: 'level' })

    // Unlike a budget, the balance does not start again with the month.
    expect(await usage.left('u1', 'packs', { now: utc('2026-12-01T00:00:00') })).toBe(93)
    expect((await usage.totals('u1', 'packs')).map((period) => period.spent)).toEqual([4, 3])
  })

  it('keeps the totals of the newest periods only', async () => {
    const { usage } = await setup(3)

    for (const month of ['06', '07', '08', '09', '10']) {
      await usage.spend('u1', 'ai', Number(month), { now: utc(`2026-${month}-15T00:00:00`) })
    }

    expect((await usage.totals('u1', 'ai')).map((period) => period.spent)).toEqual([10, 9, 8])
  })

  it('takes nothing and writes nothing for an amount of 0 and for a refusal', async () => {
    const { usage, store } = await setup()
    const writes = vi.spyOn(store, 'transact')

    expect(await usage.spend('u1', 'ai', 0, october)).toEqual({ ok: true, left: 100 })
    expect(await usage.spend('u1', 'packs', 0)).toEqual({ ok: true, left: 0 })
    expect(await usage.spend('u1', 'ai', 101, october)).toEqual({ ok: false, left: 100 })

    expect(writes).toHaveBeenCalledTimes(3)
    expect(await store.read('u1')).toBeNull()
  })

  it('answers what is left with one read and no write', async () => {
    const { usage, store } = await setup()
    await usage.spend('u1', 'ai', 10, october)
    const reads = vi.spyOn(store, 'read')
    const writes = vi.spyOn(store, 'transact')

    expect(await usage.left('u1', 'ai', october)).toBe(90)

    expect(reads).toHaveBeenCalledTimes(1)
    expect(writes).not.toHaveBeenCalled()
  })

  it('keeps subjects apart that differ only in case or contain path characters', async () => {
    const { usage } = await setup()

    await usage.spend('User', 'ai', 10, october)
    await usage.spend('user', 'ai', 20, october)
    await usage.spend('../user', 'ai', 30, october)
    await usage.spend('a/b', 'ai', 40, october)

    expect(await usage.left('User', 'ai', october)).toBe(90)
    expect(await usage.left('user', 'ai', october)).toBe(80)
    expect(await usage.left('../user', 'ai', october)).toBe(70)
    expect(await usage.left('a/b', 'ai', october)).toBe(60)
  })
})

describe('createUsage', () => {
  const setup = (): UsageInstance<typeof balances> =>
    createUsage({ store: createMemoryUsageStore(), balances })

  it('refuses an amount that is not a whole number, 0 or more', async () => {
    const usage = setup()

    for (const amount of [1.5, -1, Number.NaN, Infinity, 2 ** 53]) {
      await expect(usage.spend('u1', 'ai', amount)).rejects.toThrow(/whole number/)
      await expect(usage.credit('u1', 'packs', amount, { key: 'k' })).rejects.toThrow(
        /whole number/,
      )
    }
    // @ts-expect-error an amount is a number
    await expect(usage.spend('u1', 'ai', '5')).rejects.toThrow(UsageError)
    expect(await usage.left('u1', 'ai')).toBe(100)
    expect(await usage.left('u1', 'packs')).toBe(0)
  })

  it('refuses a credit that would make the balance too large to count exactly', async () => {
    const usage = setup()
    await usage.credit('u1', 'packs', Number.MAX_SAFE_INTEGER, { key: 'a' })

    await expect(usage.credit('u1', 'packs', 1, { key: 'b' })).rejects.toThrow(/too large/)
    expect(await usage.left('u1', 'packs')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses an unknown balance, an empty subject and a credit without a key', async () => {
    const usage = setup()

    // @ts-expect-error 'tokens' is not a balance of the config
    await expect(usage.left('u1', 'tokens')).rejects.toThrow(/unknown balance "tokens"/)
    // @ts-expect-error 'toString' is not a balance of the config
    await expect(usage.spend('u1', 'toString', 1)).rejects.toThrow(/unknown balance/)
    await expect(usage.left('', 'ai')).rejects.toThrow(/subject/)
    await expect(usage.spend('', 'ai', 1)).rejects.toThrow(/subject/)
    await expect(usage.credit('u1', 'packs', 1, { key: '' })).rejects.toThrow(/key/)
    // @ts-expect-error a credit needs its options
    await expect(usage.credit('u1', 'packs', 1)).rejects.toThrow(/key/)
  })

  it('refuses a credit to a budget', async () => {
    const usage = setup()

    // @ts-expect-error 'ai' is a budget, not a prepaid balance
    await expect(usage.credit('u1', 'ai', 10, { key: 'k' })).rejects.toThrow(/is a budget/)
    expect(await usage.left('u1', 'ai')).toBe(100)
  })

  it('refuses a budget without an amount, and an amount, tag or date that is not valid', async () => {
    const usage = setup()

    await expect(usage.left('u1', 'plan')).rejects.toThrow(/has no amount/)
    await expect(usage.spend('u1', 'plan', 1)).rejects.toThrow(/has no amount/)
    await expect(usage.left('u1', 'ai', { budget: -1 })).rejects.toThrow(/`budget`/)
    await expect(usage.left('u1', 'ai', { budget: 1.5 })).rejects.toThrow(/`budget`/)
    await expect(usage.spend('u1', 'ai', 1, { tag: '' })).rejects.toThrow(/tag/)
    await expect(usage.spend('u1', 'ai', 1, { tag: 'x'.repeat(65) })).rejects.toThrow(/tag/)
    await expect(usage.left('u1', 'ai', { now: new Date('never') })).rejects.toThrow(/`now`/)
    await expect(usage.left('u1', 'ai', { anchor: new Date('never') })).rejects.toThrow(/`anchor`/)
  })

  it('refuses a config it cannot count with', () => {
    const store = createMemoryUsageStore()

    expect(() => createUsage({ store, balances: { ai: { kind: 'budget', amount: 1.5 } } })).toThrow(
      /`amount` of balance "ai"/,
    )
    expect(() => createUsage({ store, balances, keepPeriods: 0 })).toThrow(/keepPeriods/)
    expect(() =>
      // @ts-expect-error 'monthly' is not a kind
      createUsage({ store, balances: { ai: { kind: 'monthly' } } }),
    ).toThrow(/kind/)
  })

  it('lets what the store throws through, and takes nothing then', async () => {
    const store = createMemoryUsageStore()
    const usage = createUsage({ store, balances })
    vi.spyOn(store, 'transact').mockRejectedValueOnce(new Error('store down'))

    await expect(usage.spend('u1', 'ai', 10)).rejects.toThrow('store down')
    expect(await usage.left('u1', 'ai')).toBe(100)
  })
})

describe('periodOf', () => {
  const period = (now: string, anchor?: string) =>
    periodOf(utc(now), anchor === undefined ? undefined : utc(anchor))

  it('is the calendar month in UTC without an anchor', () => {
    expect(period('2026-10-09T12:00:00')).toEqual({
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    })
    expect(period('2026-12-31T23:59:59')).toEqual({
      start: '2026-12-01T00:00:00.000Z',
      end: '2027-01-01T00:00:00.000Z',
    })
    expect(period('2028-02-29T00:00:00').end).toBe('2028-03-01T00:00:00.000Z')
  })

  it('starts at the day and time of the anchor', () => {
    expect(period('2026-10-17T08:30:00', '2026-01-17T08:30:00')).toEqual({
      start: '2026-10-17T08:30:00.000Z',
      end: '2026-11-17T08:30:00.000Z',
    })
    expect(period('2026-10-17T08:29:59', '2026-01-17T08:30:00').start).toBe(
      '2026-09-17T08:30:00.000Z',
    )
    // The period the anchor itself starts, and the one before it.
    expect(period('2026-01-17T08:30:00', '2026-01-17T08:30:00').start).toBe(
      '2026-01-17T08:30:00.000Z',
    )
    expect(period('2026-01-10T00:00:00', '2026-01-17T08:30:00')).toEqual({
      start: '2025-12-17T08:30:00.000Z',
      end: '2026-01-17T08:30:00.000Z',
    })
  })

  it('uses the last day of a month that is too short, and returns to the anchor day after it', () => {
    const anchor = '2026-01-31T10:00:00'
    expect(period('2026-02-15T00:00:00', anchor)).toEqual({
      start: '2026-01-31T10:00:00.000Z',
      end: '2026-02-28T10:00:00.000Z',
    })
    expect(period('2026-03-01T00:00:00', anchor)).toEqual({
      start: '2026-02-28T10:00:00.000Z',
      end: '2026-03-31T10:00:00.000Z',
    })
    expect(period('2026-04-30T10:00:00', anchor)).toEqual({
      start: '2026-04-30T10:00:00.000Z',
      end: '2026-05-31T10:00:00.000Z',
    })
    expect(period('2028-02-29T10:00:00', anchor).start).toBe('2028-02-29T10:00:00.000Z')
  })

  it('leaves no gap and no overlap between periods', () => {
    const anchor = utc('2025-08-31T23:59:59')
    let cursor = utc('2025-09-01T00:00:00')
    for (let step = 0; step < 40; step++) {
      const current = periodOf(cursor, anchor)
      expect(current.start <= cursor.toISOString()).toBe(true)
      expect(cursor.toISOString() < current.end).toBe(true)
      // The end of one period is the start of the next.
      expect(periodOf(new Date(current.end), anchor).start).toBe(current.end)
      expect(periodOf(new Date(new Date(current.end).getTime() - 1), anchor).start).toBe(
        current.start,
      )
      cursor = new Date(current.end)
    }
  })
})

describe('createFlatdbUsageStore', () => {
  it('refuses an adapter without conditional writes', () => {
    const adapter = { read: async () => null }
    expect(() => createFlatdbUsageStore({ adapter })).toThrow(/readVersioned\/writeIf/)
  })

  it('writes one JSON file per subject below the prefix', async () => {
    const adapter = new MemoryAdapter()
    const usage = createUsage({
      store: createFlatdbUsageStore({ adapter, prefix: '/counts/' }),
      balances,
    })

    await usage.credit('User 1', 'packs', 10, { key: 'evt_1' })
    await usage.spend('User 1', 'packs', 4, { now: utc('2026-10-09T00:00:00'), tag: 'level' })

    expect(JSON.parse((await adapter.read('counts/~55ser~201.json'))!)).toEqual({
      subject: 'User 1',
      balances: {
        packs: {
          balance: 6,
          credits: ['evt_1'],
          periods: [
            {
              start: '2026-10-01T00:00:00.000Z',
              end: '2026-11-01T00:00:00.000Z',
              spent: 4,
              tags: { level: 4 },
            },
          ],
        },
      },
    })
  })

  it('refuses a file it cannot trust instead of guessing a balance', async () => {
    const adapter = new MemoryAdapter()
    const usage = createUsage({ store: createFlatdbUsageStore({ adapter }), balances })
    const broken = [
      '[]',
      '{"subject":"u1"}',
      '{"balances":{"packs":{"balance":-5,"credits":[],"periods":[]}}}',
      '{"balances":{"packs":{"balance":"10","credits":[],"periods":[]}}}',
      '{"balances":{"packs":{"balance":1.5,"credits":[],"periods":[]}}}',
      '{"balances":{"packs":{"balance":1,"credits":[],"periods":[{"start":"x","end":"y","spent":-1,"tags":{}}]}}}',
    ]

    for (const content of broken) {
      await adapter.write('usage/u1.json', content)
      await expect(usage.left('u1', 'packs')).rejects.toThrow(/not a usage record/)
      await expect(usage.spend('u1', 'packs', 1)).rejects.toThrow(/not a usage record/)
    }
    await expect(usage.left('', 'packs')).rejects.toThrow(UsageError)
    await expect(usage.left('x'.repeat(201), 'packs')).rejects.toThrow(/cannot be a file name/)
  })

  it('gives up with an error when it keeps losing against other writers', async () => {
    const adapter = new MemoryAdapter()
    const usage = createUsage({ store: createFlatdbUsageStore({ adapter }), balances })
    await usage.credit('u1', 'packs', 10, { key: 'evt_1' })
    // Every conditional write loses, as against a writer that is always faster.
    const losing = createUsage({
      store: createFlatdbUsageStore({
        adapter: {
          read: (path) => adapter.read(path),
          readVersioned: (path) => adapter.readVersioned(path),
          writeIf: async () => null,
        },
      }),
      balances,
    })

    await expect(losing.spend('u1', 'packs', 1)).rejects.toThrow(/20 attempts lost/)
    expect(await usage.left('u1', 'packs')).toBe(10)
  })
})
