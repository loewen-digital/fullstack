import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsAdapter, MemoryAdapter } from '@loewen-digital/flatdb'
import { BillingError, createBilling, createMemoryBillingStore } from '../index.js'
import type { BillingStore } from '../index.js'
import { createFlatdbBillingStore } from '../stores/flatdb.js'
import { createFakeBillingDriver } from '../../testing/index.js'

const products = {
  unlock: { type: 'one-time', providerId: 'pri_unlock', features: ['everything'] },
  basic: {
    type: 'subscription',
    providerId: 'pri_basic',
    features: ['sync'],
    limits: { feeds: 50 },
  },
  pro: {
    type: 'subscription',
    providerId: 'pri_pro',
    features: ['sync', 'export'],
    limits: { feeds: 500, seats: 5 },
  },
} as const

const free = { features: ['read'], limits: { feeds: 5 } } as const

const DAY = 86_400_000
const day = (n: number): Date => new Date(Date.UTC(2026, 9, 1) + n * DAY)

const tmpDirs: string[] = []
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const stores: [string, () => Promise<BillingStore>][] = [
  ['memory store', async () => createMemoryBillingStore()],
  [
    'flatdb store on MemoryAdapter',
    async () => createFlatdbBillingStore({ adapter: new MemoryAdapter() }),
  ],
  [
    'flatdb store on FsAdapter',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fullstack-entitlements-'))
      tmpDirs.push(dir)
      return createFlatdbBillingStore({ adapter: new FsAdapter(dir) })
    },
  ],
]

describe.each(stores)('entitlements on the %s', (_name, createStore) => {
  async function setup(pastDueGraceDays?: number) {
    const driver = createFakeBillingDriver()
    const store = await createStore()
    const billing = createBilling({
      driver,
      store,
      products,
      entitlements: { default: free, pastDueGraceDays },
    })
    const deliver = (...events: Parameters<typeof driver.webhook>[0][]) =>
      billing.handleWebhook(driver.webhook(events.flat()))
    return { billing, driver, store, deliver }
  }

  const pro = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_pro' } as const
  const unlock = { userId: 'u1', providerId: 'pri_unlock', holdingId: 'txn_unlock' } as const

  it('gives a user who bought nothing the default', async () => {
    const { billing } = await setup()

    const entitlements = await billing.entitlements('u1')

    expect(entitlements).toMatchObject({
      userId: 'u1',
      products: [],
      features: ['read'],
      limits: { feeds: 5, seats: 0 },
    })
    expect(entitlements.has('read')).toBe(true)
    expect(entitlements.has('export')).toBe(false)
    expect(entitlements.limit('feeds')).toBe(5)
    // A limit nothing sets for this user is 0, not undefined.
    expect(entitlements.limit('seats')).toBe(0)
  })

  it('grants what an active subscription gives', async () => {
    const { billing, deliver } = await setup()
    await deliver({ ...pro, type: 'subscription.started', occurredAt: day(0) })

    const entitlements = await billing.entitlements('u1', { now: day(1) })

    expect(entitlements.products).toEqual(['pro'])
    expect(entitlements.features).toEqual(['read', 'sync', 'export'])
    expect(entitlements.limits).toEqual({ feeds: 500, seats: 5 })
    expect(entitlements.has('export')).toBe(true)
    // Another user has nothing of it.
    expect((await billing.entitlements('u2', { now: day(1) })).has('export')).toBe(false)
  })

  it('grants a one-time purchase for good', async () => {
    const { billing, deliver } = await setup()
    await deliver({ ...unlock, type: 'purchase.completed', occurredAt: day(0) })

    expect((await billing.entitlements('u1', { now: day(1) })).has('everything')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(365 * 30) })).has('everything')).toBe(true)
  })

  it('grants a canceled subscription until the date its access ends, and not after', async () => {
    const { billing, deliver } = await setup()
    await deliver(
      { ...pro, type: 'subscription.started', occurredAt: day(0), currentPeriodEnd: day(30) },
      { ...pro, type: 'subscription.canceled', occurredAt: day(10), accessEndsAt: day(30) },
    )

    const paidThrough = await billing.entitlements('u1', { now: day(29) })
    const lastMoment = await billing.entitlements('u1', { now: new Date(day(30).getTime() - 1) })
    const over = await billing.entitlements('u1', { now: day(30) })

    expect(paidThrough.has('export')).toBe(true)
    expect(paidThrough.limit('feeds')).toBe(500)
    expect(lastMoment.has('export')).toBe(true)
    expect(over.has('export')).toBe(false)
    expect(over.products).toEqual([])
    expect(over.limit('feeds')).toBe(5)
  })

  it('keeps access after a failed payment until the provider gives up, by default', async () => {
    const { billing, deliver } = await setup()
    await deliver(
      { ...pro, type: 'subscription.started', occurredAt: day(0) },
      { ...pro, type: 'payment.failed', occurredAt: day(30) },
    )

    // The provider is still trying, however long that takes.
    expect((await billing.entitlements('u1', { now: day(31) })).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(90) })).has('export')).toBe(true)

    // It gave up: the subscription is canceled, effective at once.
    await deliver({
      ...pro,
      type: 'subscription.canceled',
      occurredAt: day(44),
      accessEndsAt: day(44),
    })
    expect((await billing.entitlements('u1', { now: day(45) })).has('export')).toBe(false)
  })

  it('keeps access after a failed payment for the grace period of the config', async () => {
    const { billing, deliver } = await setup(7)
    await deliver(
      { ...pro, type: 'subscription.started', occurredAt: day(0) },
      { ...pro, type: 'payment.failed', occurredAt: day(30) },
    )

    expect((await billing.entitlements('u1', { now: day(36) })).has('export')).toBe(true)

    // A second failed attempt does not start the period again.
    await deliver({ ...pro, type: 'payment.failed', occurredAt: day(35) })
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'past_due',
      pastDueSince: day(30),
    })
    expect((await billing.entitlements('u1', { now: day(36) })).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(37) })).has('export')).toBe(false)
    expect((await billing.entitlements('u1', { now: day(37) })).limit('feeds')).toBe(5)

    // Paid after all: access is back, and a later failure gets a grace period of its own.
    await deliver({ ...pro, type: 'subscription.renewed', occurredAt: day(38) })
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'active',
      pastDueSince: null,
    })
    expect((await billing.entitlements('u1', { now: day(39) })).has('export')).toBe(true)
    await deliver({ ...pro, type: 'payment.failed', occurredAt: day(60) })
    expect((await billing.entitlements('u1', { now: day(66) })).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(67) })).has('export')).toBe(false)
  })

  it('ends access with the failed payment when the grace period is 0', async () => {
    const { billing, deliver } = await setup(0)
    await deliver(
      { ...pro, type: 'subscription.started', occurredAt: day(0) },
      { ...pro, type: 'payment.failed', occurredAt: day(30) },
    )

    expect((await billing.entitlements('u1', { now: day(30) })).has('export')).toBe(false)
  })

  it('revokes with a refund', async () => {
    const { billing, deliver } = await setup()
    await deliver(
      { ...unlock, type: 'purchase.completed', occurredAt: day(0) },
      { ...pro, type: 'subscription.started', occurredAt: day(0), currentPeriodEnd: day(30) },
    )
    expect((await billing.entitlements('u1', { now: day(1) })).products).toEqual(['unlock', 'pro'])

    await deliver({ ...unlock, type: 'payment.refunded', occurredAt: day(2) })
    const afterFirst = await billing.entitlements('u1', { now: day(3) })
    expect(afterFirst.has('everything')).toBe(false)
    expect(afterFirst.has('export')).toBe(true)

    // A refunded subscription payment revokes although the paid period is not over.
    await deliver({ ...pro, type: 'payment.refunded', occurredAt: day(4) })
    const afterSecond = await billing.entitlements('u1', { now: day(5) })
    expect(afterSecond.products).toEqual([])
    expect(afterSecond.features).toEqual(['read'])
  })

  it('grants by hand without a purchase, and until the end date of the grant', async () => {
    const { billing } = await setup()

    const forGood = await billing.grant('tester', 'pro')
    const gift = await billing.grant('friend', 'unlock', { until: day(30) })

    expect(forGood).toMatchObject({ product: 'pro', until: null })
    expect(gift).toMatchObject({ product: 'unlock', until: day(30) })
    expect((await billing.entitlements('tester', { now: day(3650) })).has('export')).toBe(true)
    expect((await billing.entitlements('friend', { now: day(29) })).has('everything')).toBe(true)
    expect((await billing.entitlements('friend', { now: day(30) })).has('everything')).toBe(false)
    expect((await billing.account('friend')).grants).toEqual([
      { product: 'unlock', grantedAt: gift.grantedAt, until: day(30) },
    ])
    expect((await billing.account('friend')).holdings).toEqual([])
  })

  it('keeps a grant by hand through billing events, a refund of the same product included', async () => {
    const { billing, deliver } = await setup()
    await billing.grant('u1', 'pro')

    await deliver(
      { ...unlock, type: 'purchase.completed', occurredAt: day(0) },
      { ...pro, type: 'subscription.started', occurredAt: day(0) },
      { ...pro, type: 'payment.failed', occurredAt: day(30) },
      { ...pro, type: 'subscription.canceled', occurredAt: day(31), accessEndsAt: day(31) },
      { ...pro, type: 'payment.refunded', occurredAt: day(32) },
    )

    expect((await billing.account('u1')).grants).toHaveLength(1)
    const entitlements = await billing.entitlements('u1', { now: day(40) })
    expect(entitlements.products).toEqual(['unlock', 'pro'])
    expect(entitlements.has('export')).toBe(true)
  })

  it('revokes a grant by hand and leaves what was paid for', async () => {
    const { billing, deliver } = await setup()
    await deliver({ ...unlock, type: 'purchase.completed', occurredAt: day(0) })
    await billing.grant('u1', 'pro')
    await billing.grant('u1', 'unlock')

    expect(await billing.revoke('u1', 'pro')).toBe(true)
    expect(await billing.revoke('u1', 'pro')).toBe(false)
    expect(await billing.revoke('u1', 'unlock')).toBe(true)
    expect(await billing.revoke('nobody', 'pro')).toBe(false)

    const entitlements = await billing.entitlements('u1', { now: day(1) })
    expect(entitlements.has('export')).toBe(false)
    // The purchase is not a grant by hand: it stays.
    expect(entitlements.has('everything')).toBe(true)
    expect((await billing.account('u1')).grants).toEqual([])
  })

  it('replaces a grant when the same product is granted again', async () => {
    const { billing } = await setup()

    await billing.grant('u1', 'pro', { until: day(10) })
    await billing.grant('u1', 'pro', { until: day(20) })

    expect((await billing.account('u1')).grants).toHaveLength(1)
    expect((await billing.entitlements('u1', { now: day(15) })).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(20) })).has('export')).toBe(false)
  })

  it('adds features up and takes the highest value of a limit', async () => {
    const { billing, deliver } = await setup()
    await deliver(
      {
        userId: 'u1',
        providerId: 'pri_basic',
        holdingId: 'sub_basic',
        type: 'subscription.started',
      },
      { ...unlock, type: 'purchase.completed' },
    )

    const basic = await billing.entitlements('u1')
    expect(basic.features).toEqual(['read', 'everything', 'sync'])
    expect(basic.limits).toEqual({ feeds: 50, seats: 0 })

    await billing.grant('u1', 'pro')
    const both = await billing.entitlements('u1')
    expect(both.products).toEqual(['unlock', 'basic', 'pro'])
    expect(both.limits).toEqual({ feeds: 500, seats: 5 })
  })

  it('keeps every grant and every event that arrive for one user at the same moment', async () => {
    const { billing, driver } = await setup()

    await Promise.all([
      billing.grant('u1', 'pro'),
      billing.grant('u1', 'basic'),
      ...Array.from({ length: 10 }, (_, index) =>
        billing.handleWebhook(
          driver.webhook({
            type: 'purchase.completed',
            userId: 'u1',
            providerId: 'pri_unlock',
            holdingId: `txn_${index}`,
          }),
        ),
      ),
    ])

    const account = await billing.account('u1')
    expect(account.grants.map((grant) => grant.product).sort()).toEqual(['basic', 'pro'])
    expect(account.holdings).toHaveLength(10)
  })

  it('reads the store once and never asks the provider', async () => {
    const { billing, driver, store, deliver } = await setup()
    await deliver({ ...pro, type: 'subscription.started' })
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const reads = vi.spyOn(store, 'getAccount')
    const writes = vi.spyOn(store, 'transact')
    const lookups = vi.spyOn(store, 'findUserId')

    const entitlements = await billing.entitlements('u1')
    entitlements.has('export')
    entitlements.limit('feeds')

    expect(reads).toHaveBeenCalledTimes(1)
    expect(writes).not.toHaveBeenCalled()
    expect(lookups).not.toHaveBeenCalled()
    expect(fetched).not.toHaveBeenCalled()
    expect(driver.checkouts).toEqual([])
    expect(driver.manageRequests).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('entitlements', () => {
  it('follows the console driver from checkout to cancel', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const billing = createBilling({
      driver: 'console',
      store: createMemoryBillingStore(),
      products,
      entitlements: { default: free },
    })
    const open = (url: string | null) => new Request(new URL(url ?? '', 'https://app.example'))

    expect((await billing.entitlements('u1')).has('export')).toBe(false)

    const checkout = await billing.checkout({ userId: 'u1', product: 'pro' })
    // Coming back from a checkout grants nothing; the event does.
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
    await billing.handleWebhook(open(checkout.url))
    expect((await billing.entitlements('u1')).has('export')).toBe(true)

    await billing.handleWebhook(open(await billing.manageUrl('u1')))
    const [holding] = (await billing.account('u1')).holdings
    expect(holding).toMatchObject({ status: 'canceled' })
    const end = holding!.accessEndsAt!
    expect(
      (await billing.entitlements('u1', { now: new Date(end.getTime() - 1) })).has('export'),
    ).toBe(true)
    expect((await billing.entitlements('u1', { now: end })).has('export')).toBe(false)
    vi.restoreAllMocks()
  })

  it('ignores a holding and a grant whose product left the config', async () => {
    const store = createMemoryBillingStore()
    const driver = createFakeBillingDriver()
    const before = createBilling({ driver, store, products })
    await before.handleWebhook(
      driver.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
    )
    await before.grant('u1', 'basic')

    const after = createBilling({
      driver,
      store,
      products: { unlock: products.unlock },
      entitlements: { default: free },
    })

    const entitlements = await after.entitlements('u1')
    expect(entitlements.products).toEqual([])
    expect(entitlements.features).toEqual(['read'])
    expect(entitlements.limits).toEqual({ feeds: 5 })
  })

  it('takes the highest value of a limit whatever the order of the config', async () => {
    const billing = createBilling({
      driver: createFakeBillingDriver(),
      store: createMemoryBillingStore(),
      products: {
        big: { type: 'subscription', providerId: 'pri_big', limits: { feeds: 500 } },
        small: { type: 'subscription', providerId: 'pri_small', limits: { feeds: 10, seats: 2 } },
      },
      entitlements: { default: { limits: { feeds: 100 } } },
    })

    await billing.grant('u1', 'small')
    // The default is more generous than the product: it still counts.
    expect((await billing.entitlements('u1')).limits).toEqual({ feeds: 100, seats: 2 })

    await billing.grant('u1', 'big')
    expect((await billing.entitlements('u1')).limits).toEqual({ feeds: 500, seats: 2 })
  })

  it('answers without a default and without features on the products', async () => {
    const billing = createBilling({
      driver: createFakeBillingDriver(),
      store: createMemoryBillingStore(),
      products: {
        plain: { type: 'one-time', providerId: 'pri_plain' },
        big: { type: 'subscription', providerId: 'pri_big', limits: { storage: Infinity } },
      },
    })
    await billing.grant('u1', 'big')

    expect(await billing.entitlements('u2')).toMatchObject({ features: [], limits: { storage: 0 } })
    expect((await billing.entitlements('u1')).limit('storage')).toBe(Infinity)
  })

  it('refuses a grant for an unknown product, an invalid end date and an empty user id', async () => {
    const billing = createBilling({
      driver: createFakeBillingDriver(),
      store: createMemoryBillingStore(),
      products,
    })

    // @ts-expect-error 'team' is not a product of the config
    await expect(billing.grant('u1', 'team')).rejects.toThrow(BillingError)
    await expect(billing.grant('u1', 'pro', { until: new Date('never') })).rejects.toThrow(
      /not a valid date/,
    )
    await expect(billing.grant('', 'pro')).rejects.toThrow(BillingError)
    await expect(billing.entitlements('')).rejects.toThrow(BillingError)
    expect((await billing.account('u1')).grants).toEqual([])
  })

  it('refuses a grace period or a limit that is not a number', () => {
    const base = { driver: createFakeBillingDriver(), store: createMemoryBillingStore() }

    expect(() =>
      createBilling({ ...base, products, entitlements: { pastDueGraceDays: -1 } }),
    ).toThrow(/pastDueGraceDays/)
    expect(() =>
      createBilling({ ...base, products, entitlements: { pastDueGraceDays: Number.NaN } }),
    ).toThrow(/pastDueGraceDays/)
    expect(() =>
      createBilling({
        ...base,
        products: { pro: { type: 'subscription', providerId: 'p', limits: { feeds: Number.NaN } } },
      }),
    ).toThrow(/limit "feeds" of product "pro"/)
    expect(() =>
      createBilling({
        ...base,
        products,
        // @ts-expect-error a limit is a number
        entitlements: { default: { limits: { feeds: 'many' } } },
      }),
    ).toThrow(/limit "feeds" of the default/)
  })

  it('types features, limits and products from the config', async () => {
    const billing = createBilling({
      driver: createFakeBillingDriver(),
      store: createMemoryBillingStore(),
      products,
      entitlements: { default: free },
    })
    const entitlements = await billing.entitlements('u1')

    const feature: 'read' | 'everything' | 'sync' | 'export' | undefined = entitlements.features[0]
    const held: 'unlock' | 'basic' | 'pro' | undefined = entitlements.products[0]
    expect(feature).toBe('read')
    expect(held).toBeUndefined()
    // @ts-expect-error 'exprot' is not a feature of the config
    expect(entitlements.has('exprot')).toBe(false)
    // @ts-expect-error 'sites' is not a limit of the config
    expect(entitlements.limit('sites')).toBe(0)
  })
})

describe('entitlements on account files of the flatdb store', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: day(40) })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads a file written before grants and `pastDueSince` existed', async () => {
    const adapter = new MemoryAdapter()
    await adapter.write(
      'billing/accounts/u1.json',
      JSON.stringify({
        userId: 'u1',
        customerId: null,
        holdings: [
          {
            id: 'sub_pro',
            product: 'pro',
            type: 'subscription',
            status: 'past_due',
            startedAt: day(0).toISOString(),
            currentPeriodEnd: day(30).toISOString(),
            accessEndsAt: null,
            updatedAt: day(30).toISOString(),
          },
        ],
        appliedEvents: ['evt_1'],
      }),
    )
    const billing = createBilling({
      driver: createFakeBillingDriver(),
      store: createFlatdbBillingStore({ adapter }),
      products,
      entitlements: { pastDueGraceDays: 14 },
    })

    expect(await billing.account('u1')).toMatchObject({
      grants: [],
      holdings: [{ status: 'past_due', pastDueSince: null }],
    })
    // Without the date of the first failure, the newest event of the holding counts: day 30.
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: day(44) })).has('export')).toBe(false)

    await billing.grant('u1', 'unlock', { until: day(50) })
    expect((await billing.account('u1')).grants).toEqual([
      { product: 'unlock', grantedAt: day(40), until: day(50) },
    ])
  })
})
