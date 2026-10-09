import { afterAll, describe, it, expect, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsAdapter, MemoryAdapter } from '@loewen-digital/flatdb'
import { BillingError, createBilling, createMemoryBillingStore } from '../index.js'
import type { BillingStore } from '../index.js'
import { createFlatdbBillingStore } from '../stores/flatdb.js'
import { createFakeBillingDriver } from '../../testing/index.js'

const products = {
  unlock: { type: 'one-time', providerId: 'pri_unlock' },
  pro: { type: 'subscription', providerId: 'pri_pro' },
  team: { type: 'subscription', providerId: 'pri_team' },
} as const

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 9, 12, minute))

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
      const dir = await mkdtemp(join(tmpdir(), 'fullstack-billing-'))
      tmpDirs.push(dir)
      return createFlatdbBillingStore({ adapter: new FsAdapter(dir) })
    },
  ],
]

describe.each(stores)('billing on the %s', (_name, createStore) => {
  async function setup() {
    const driver = createFakeBillingDriver()
    const onError = vi.fn()
    const store = await createStore()
    const billing = createBilling({ driver, store, products, onError })
    return { billing, driver, store, onError }
  }

  it('knows nothing about a user without events', async () => {
    const { billing } = await setup()
    expect(await billing.account('u1')).toEqual({ userId: 'u1', customerId: null, holdings: [] })
  })

  it('applies a completed one-time purchase', async () => {
    const { billing, driver } = await setup()

    const { response, events, skipped } = await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        id: 'evt_1',
        userId: 'u1',
        customerId: 'cus_1',
        providerId: 'pri_unlock',
        holdingId: 'txn_1',
        occurredAt: at(0),
      }),
    )

    expect(response.status).toBe(200)
    expect(skipped).toEqual([])
    expect(events).toEqual([
      {
        type: 'purchase.completed',
        id: 'evt_1',
        occurredAt: at(0),
        userId: 'u1',
        product: 'unlock',
        holdingId: 'txn_1',
      },
    ])
    expect(await billing.account('u1')).toEqual({
      userId: 'u1',
      customerId: 'cus_1',
      holdings: [
        {
          id: 'txn_1',
          product: 'unlock',
          type: 'one-time',
          status: 'active',
          startedAt: at(0),
          currentPeriodEnd: null,
          accessEndsAt: null,
          updatedAt: at(0),
        },
      ],
    })
  })

  it('follows a subscription from start to cancel', async () => {
    const { billing, driver } = await setup()
    const subscription = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_1' }
    const holding = async () => (await billing.account('u1')).holdings[0]

    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.started',
        occurredAt: at(0),
        currentPeriodEnd: at(30),
      }),
    )
    expect(await holding()).toMatchObject({
      product: 'pro',
      type: 'subscription',
      status: 'active',
      startedAt: at(0),
      currentPeriodEnd: at(30),
    })

    await billing.handleWebhook(
      driver.webhook({ ...subscription, type: 'payment.failed', occurredAt: at(30) }),
    )
    expect(await holding()).toMatchObject({ status: 'past_due', currentPeriodEnd: at(30) })

    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.renewed',
        occurredAt: at(31),
        currentPeriodEnd: at(60),
      }),
    )
    expect(await holding()).toMatchObject({ status: 'active', currentPeriodEnd: at(60) })

    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.changed',
        providerId: 'pri_team',
        occurredAt: at(32),
        currentPeriodEnd: at(60),
      }),
    )
    expect(await holding()).toMatchObject({ product: 'team', status: 'active' })

    const canceled = await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.canceled',
        providerId: 'pri_team',
        occurredAt: at(33),
        accessEndsAt: at(60),
      }),
    )
    expect(canceled.events[0]).toMatchObject({
      type: 'subscription.canceled',
      accessEndsAt: at(60),
    })
    expect(await holding()).toMatchObject({
      status: 'canceled',
      accessEndsAt: at(60),
      startedAt: at(0),
      updatedAt: at(33),
    })

    // A change after the cancel takes it back (the user resumed in the provider's portal).
    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.changed',
        providerId: 'pri_team',
        occurredAt: at(34),
      }),
    )
    expect(await holding()).toMatchObject({
      status: 'active',
      accessEndsAt: null,
      currentPeriodEnd: at(60),
    })
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('marks a refund and ends access at its date', async () => {
    const { billing, driver } = await setup()
    const purchase = { userId: 'u1', providerId: 'pri_unlock', holdingId: 'txn_1' }

    await billing.handleWebhook(
      driver.webhook({ ...purchase, type: 'purchase.completed', occurredAt: at(0) }),
    )
    await billing.handleWebhook(
      driver.webhook({ ...purchase, type: 'payment.refunded', occurredAt: at(5) }),
    )

    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'refunded',
      accessEndsAt: at(5),
    })
  })

  it('keeps a failed payment away from what it does not concern', async () => {
    const { billing, driver } = await setup()

    // Nothing held: the event counts as applied, and there is still no holding.
    const first = await billing.handleWebhook(
      driver.webhook({ type: 'payment.failed', userId: 'u1', providerId: 'pri_pro', id: 'evt_f' }),
    )
    expect(first.events).toHaveLength(1)
    expect((await billing.account('u1')).holdings).toEqual([])

    // A canceled subscription stays canceled.
    const subscription = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_1' }
    await billing.handleWebhook(
      driver.webhook([
        { ...subscription, type: 'subscription.started', occurredAt: at(0) },
        {
          ...subscription,
          type: 'subscription.canceled',
          occurredAt: at(1),
          accessEndsAt: at(30),
        },
        { ...subscription, type: 'payment.failed', occurredAt: at(2) },
      ]),
    )
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: at(30),
    })
  })

  it('applies an event once when it is delivered again', async () => {
    const { billing, driver } = await setup()
    const event = {
      type: 'purchase.completed',
      id: 'evt_1',
      userId: 'u1',
      providerId: 'pri_unlock',
      holdingId: 'txn_1',
      occurredAt: at(0),
    } as const

    const first = await billing.handleWebhook(driver.webhook(event))
    const second = await billing.handleWebhook(driver.webhook(event))

    expect(first.events).toHaveLength(1)
    expect(second.response.status).toBe(200)
    expect(second.events).toEqual([])
    expect(second.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('applies an event once when it is delivered many times at the same moment', async () => {
    const { billing, driver } = await setup()
    const event = {
      type: 'subscription.started',
      id: 'evt_1',
      userId: 'u1',
      providerId: 'pri_pro',
      holdingId: 'sub_1',
      occurredAt: at(0),
    } as const

    const results = await Promise.all(
      Array.from({ length: 25 }, () => billing.handleWebhook(driver.webhook(event))),
    )

    expect(results.every((result) => result.response.status === 200)).toBe(true)
    expect(results.flatMap((result) => result.events)).toHaveLength(1)
    expect(results.flatMap((result) => result.skipped).map((entry) => entry.reason)).toEqual(
      Array.from({ length: 24 }, () => 'duplicate'),
    )
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('keeps every event when different ones for one user arrive at the same moment', async () => {
    const { billing, driver, store } = await setup()

    // What a provider sends for one checkout, plus purchases of other things, all at once.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        billing.handleWebhook(
          driver.webhook({
            type: 'purchase.completed',
            id: `evt_${index}`,
            userId: 'u1',
            providerId: 'pri_unlock',
            holdingId: `txn_${index}`,
            occurredAt: at(index),
          }),
        ),
      ),
    )

    expect(results.flatMap((result) => result.events)).toHaveLength(20)
    const account = await store.getAccount('u1')
    expect(account?.holdings.map((holding) => holding.id).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `txn_${index}`).sort(),
    )
    expect(account?.appliedEvents).toHaveLength(20)
  })

  it('does not roll the state back when an older event arrives late', async () => {
    const { billing, driver } = await setup()
    const subscription = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_1' }

    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.canceled',
        occurredAt: at(10),
        accessEndsAt: at(30),
      }),
    )
    const late = await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.renewed',
        occurredAt: at(5),
        currentPeriodEnd: at(30),
      }),
    )

    expect(late.response.status).toBe(200)
    expect(late.events).toEqual([])
    expect(late.skipped.map((entry) => entry.reason)).toEqual(['stale'])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: at(30),
      updatedAt: at(10),
    })
  })

  it('keeps a refund that arrives before its purchase', async () => {
    const { billing, driver } = await setup()
    const purchase = { userId: 'u1', providerId: 'pri_unlock', holdingId: 'txn_1' }

    await billing.handleWebhook(
      driver.webhook({ ...purchase, type: 'payment.refunded', occurredAt: at(5) }),
    )
    const late = await billing.handleWebhook(
      driver.webhook({ ...purchase, type: 'purchase.completed', occurredAt: at(0) }),
    )

    expect(late.skipped.map((entry) => entry.reason)).toEqual(['stale'])
    expect((await billing.account('u1')).holdings).toEqual([
      expect.objectContaining({ id: 'txn_1', status: 'refunded' }),
    ])
  })

  it('finds the user of an event that names only the holding or the customer', async () => {
    const { billing, driver } = await setup()

    await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        userId: 'u1',
        customerId: 'cus_1',
        providerId: 'pri_unlock',
        holdingId: 'txn_1',
        occurredAt: at(0),
      }),
    )

    // A refund carries the transaction, not the user.
    const refund = await billing.handleWebhook(
      driver.webhook({
        type: 'payment.refunded',
        providerId: 'pri_unlock',
        holdingId: 'txn_1',
        occurredAt: at(1),
      }),
    )
    expect(refund.events[0]).toMatchObject({ userId: 'u1', type: 'payment.refunded' })

    // A new subscription of a known customer.
    const started = await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        customerId: 'cus_1',
        providerId: 'pri_pro',
        holdingId: 'sub_9',
        occurredAt: at(2),
      }),
    )
    expect(started.events[0]).toMatchObject({ userId: 'u1', product: 'pro' })
    expect((await billing.account('u1')).holdings.map((holding) => holding.status)).toEqual([
      'refunded',
      'active',
    ])
  })

  it('answers 409 for an event without a user, so the provider delivers it again', async () => {
    const { billing, driver } = await setup()
    const refund = {
      type: 'payment.refunded',
      id: 'evt_refund',
      providerId: 'pri_unlock',
      holdingId: 'txn_1',
      occurredAt: at(1),
    } as const

    const early = await billing.handleWebhook(driver.webhook(refund))
    expect(early.response.status).toBe(409)
    expect(early.events).toEqual([])
    expect(early.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])

    await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        userId: 'u1',
        providerId: 'pri_unlock',
        holdingId: 'txn_1',
        occurredAt: at(0),
      }),
    )
    const again = await billing.handleWebhook(driver.webhook(refund))
    expect(again.response.status).toBe(200)
    expect(again.events).toHaveLength(1)
    expect((await billing.account('u1')).holdings[0]?.status).toBe('refunded')
  })

  it('keeps the first user a provider id was linked to', async () => {
    const { store } = await setup()

    await store.link('customer', 'cus_1', 'u1')
    await store.link('customer', 'cus_1', 'u2')

    expect(await store.findUserId('customer', 'cus_1')).toBe('u1')
    expect(await store.findUserId('holding', 'cus_1')).toBeNull()
  })

  it('skips an event for a product that is not in the config', async () => {
    const { billing, driver } = await setup()

    const { response, events, skipped } = await billing.handleWebhook(
      driver.webhook({ type: 'purchase.completed', userId: 'u1', providerId: 'pri_other' }),
    )

    expect(response.status).toBe(200)
    expect(events).toEqual([])
    expect(skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('rejects a webhook that fails verification and changes nothing', async () => {
    const { billing, driver, store, onError } = await setup()

    const { response, events } = await billing.handleWebhook(driver.invalidWebhook())

    expect(response.status).toBe(401)
    expect(events).toEqual([])
    expect(await store.getAccount('u1')).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps user ids apart that differ only in case or contain path characters', async () => {
    const { billing, driver } = await setup()
    const ids = ['Abc', 'abc', '../abc', 'a/b', 'ä b.json']

    for (const userId of ids) {
      await billing.handleWebhook(
        driver.webhook({
          type: 'purchase.completed',
          userId,
          providerId: 'pri_unlock',
          holdingId: `txn_${ids.indexOf(userId)}`,
        }),
      )
    }

    for (const userId of ids) {
      const account = await billing.account(userId)
      expect(account.holdings.map((holding) => holding.id)).toEqual([`txn_${ids.indexOf(userId)}`])
    }
  })
})

describe('createBilling', () => {
  function setup() {
    const driver = createFakeBillingDriver()
    const store = createMemoryBillingStore()
    return { driver, store, billing: createBilling({ driver, store, products }) }
  }

  it('starts a checkout with the product of the config and the known customer', async () => {
    const { billing, driver } = setup()
    await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        userId: 'u1',
        customerId: 'cus_1',
        providerId: 'pri_unlock',
      }),
    )

    const checkout = await billing.checkout({
      userId: 'u1',
      product: 'pro',
      email: 'u1@example.com',
      successUrl: '/account',
    })

    expect(checkout).toEqual({
      id: 'fake_checkout_1',
      url: 'https://fake-billing.test/checkout/fake_checkout_1',
    })
    expect(driver.checkouts).toEqual([
      {
        userId: 'u1',
        product: 'pro',
        type: 'subscription',
        providerId: 'pri_pro',
        customerId: 'cus_1',
        email: 'u1@example.com',
        successUrl: '/account',
        cancelUrl: undefined,
      },
    ])
  })

  it('grants nothing from a checkout alone', async () => {
    const { billing } = setup()
    await billing.checkout({ userId: 'u1', product: 'unlock' })
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('refuses a product that is not in the config and an empty user id', async () => {
    const { billing } = setup()
    await expect(
      // @ts-expect-error 'gold' is not a product of the config
      billing.checkout({ userId: 'u1', product: 'gold' }),
    ).rejects.toThrow(BillingError)
    await expect(billing.checkout({ userId: '', product: 'pro' })).rejects.toThrow(BillingError)
  })

  it('refuses two products with the same provider id', () => {
    expect(() =>
      createBilling({
        driver: createFakeBillingDriver(),
        store: createMemoryBillingStore(),
        products: {
          a: { type: 'one-time', providerId: 'pri_1' },
          b: { type: 'subscription', providerId: 'pri_1' },
        },
      }),
    ).toThrow(/share the providerId/)
  })

  it('refuses a driver name it does not know', () => {
    expect(() =>
      createBilling({
        // @ts-expect-error 'paddle' is not built in
        driver: 'paddle',
        store: createMemoryBillingStore(),
        products,
      }),
    ).toThrow(/unknown driver "paddle"/)
  })

  it('hands the manage link of the driver through, with what the user holds', async () => {
    const { billing, driver } = setup()
    await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        userId: 'u1',
        customerId: 'cus_1',
        providerId: 'pri_pro',
      }),
    )

    const url = await billing.manageUrl('u1', { returnUrl: '/account' })

    expect(url).toBe('https://fake-billing.test/manage/u1')
    expect(driver.manageRequests[0]).toMatchObject({
      userId: 'u1',
      customerId: 'cus_1',
      returnUrl: '/account',
      providerIds: { unlock: 'pri_unlock', pro: 'pri_pro', team: 'pri_team' },
    })
    expect(driver.manageRequests[0]?.holdings).toHaveLength(1)
  })

  it('answers 500 and reports when the store fails, so the provider delivers again', async () => {
    const driver = createFakeBillingDriver()
    const memory = createMemoryBillingStore()
    let down = true
    const store: BillingStore = {
      ...memory,
      async transact(userId, change) {
        if (down) throw new Error('store down')
        return memory.transact(userId, change)
      },
    }
    const onError = vi.fn()
    const billing = createBilling({ driver, store, products, onError })
    const event = {
      type: 'purchase.completed',
      id: 'evt_1',
      userId: 'u1',
      providerId: 'pri_unlock',
    } as const

    const failed = await billing.handleWebhook(driver.webhook(event))
    expect(failed.response.status).toBe(500)
    expect(failed.events).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)

    down = false
    const retried = await billing.handleWebhook(driver.webhook(event))
    expect(retried.response.status).toBe(200)
    expect(retried.events).toHaveLength(1)
  })

  it('answers 500 when the driver fails with something other than a verification error', async () => {
    const driver = createFakeBillingDriver()
    const onError = vi.fn()
    const billing = createBilling({
      driver: {
        ...driver,
        async parseWebhook() {
          throw new Error('boom')
        },
      },
      store: createMemoryBillingStore(),
      products,
      onError,
    })

    const { response } = await billing.handleWebhook(driver.webhook([]))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'webhook failed' })
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('createFlatdbBillingStore', () => {
  it('refuses an adapter without conditional writes', () => {
    expect(() =>
      createFlatdbBillingStore({
        adapter: { read: async () => null },
      }),
    ).toThrow(/readVersioned\/writeIf/)
  })

  it('writes one file per user and per linked id below the prefix', async () => {
    const adapter = new MemoryAdapter()
    const driver = createFakeBillingDriver()
    const billing = createBilling({
      driver,
      store: createFlatdbBillingStore({ adapter, prefix: '/pay/' }),
      products,
    })

    await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        id: 'evt_1',
        userId: 'User 1',
        customerId: 'cus_1',
        providerId: 'pri_pro',
        holdingId: 'sub_1',
        occurredAt: at(0),
        currentPeriodEnd: at(30),
      }),
    )

    expect(JSON.parse((await adapter.read('pay/accounts/~55ser~201.json'))!)).toEqual({
      userId: 'User 1',
      customerId: 'cus_1',
      holdings: [
        {
          id: 'sub_1',
          product: 'pro',
          type: 'subscription',
          status: 'active',
          startedAt: at(0).toISOString(),
          currentPeriodEnd: at(30).toISOString(),
          accessEndsAt: null,
          updatedAt: at(0).toISOString(),
        },
      ],
      appliedEvents: ['evt_1'],
    })
    expect(JSON.parse((await adapter.read('pay/refs/holding/sub_1.json'))!)).toEqual({
      userId: 'User 1',
    })
    expect(JSON.parse((await adapter.read('pay/refs/customer/cus_1.json'))!)).toEqual({
      userId: 'User 1',
    })
  })

  it('gives up with an error when it keeps losing against other writers', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbBillingStore({
      adapter: {
        read: (path) => adapter.read(path),
        readVersioned: (path) => adapter.readVersioned(path),
        writeIf: async () => null,
      },
    })

    await expect(
      store.transact('u1', (account) => ({ account, result: 'written' })),
    ).rejects.toThrow(/could not be written/)
  })

  it('writes nothing when the change returns no account', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbBillingStore({ adapter })

    expect(await store.transact('u1', () => ({ result: 'untouched' }))).toBe('untouched')
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('refuses a file that is not an account, and ids that cannot be file names', async () => {
    const adapter = new MemoryAdapter()
    await adapter.write('billing/accounts/u1.json', '{"holdings":"none"}')
    const store = createFlatdbBillingStore({ adapter })

    await expect(store.getAccount('u1')).rejects.toThrow(/is not an account/)
    await expect(store.getAccount('')).rejects.toThrow(/cannot be a file name/)
    await expect(store.getAccount('x'.repeat(201))).rejects.toThrow(/cannot be a file name/)
  })
})
