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
    expect(await billing.account('u1')).toEqual({
      userId: 'u1',
      customers: {},
      holdings: [],
      grants: [],
    })
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
        provider: 'fake',
        occurredAt: at(0),
        userId: 'u1',
        product: 'unlock',
        holdingId: 'txn_1',
      },
    ])
    expect(await billing.account('u1')).toEqual({
      userId: 'u1',
      customers: { fake: 'cus_1' },
      holdings: [
        {
          provider: 'fake',
          id: 'txn_1',
          product: 'unlock',
          type: 'one-time',
          status: 'active',
          startedAt: at(0),
          currentPeriodEnd: null,
          accessEndsAt: null,
          pastDueSince: null,
          updatedAt: at(0),
        },
      ],
      grants: [],
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

    // Nothing held: the event changes nothing, is remembered, and there is still no holding.
    const failed = { type: 'payment.failed', userId: 'u1', providerId: 'pri_pro', id: 'evt_f' }
    const first = await billing.handleWebhook(driver.webhook({ ...failed, type: 'payment.failed' }))
    expect(first.response.status).toBe(200)
    expect(first.events).toEqual([])
    expect(first.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect((await billing.account('u1')).holdings).toEqual([])
    const again = await billing.handleWebhook(driver.webhook({ ...failed, type: 'payment.failed' }))
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])

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

  it('reports a change once when the provider tells it with two events', async () => {
    const { billing, driver } = await setup()
    const subscription = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_1' }
    await billing.handleWebhook(
      driver.webhook({
        ...subscription,
        type: 'subscription.started',
        occurredAt: at(0),
        currentPeriodEnd: at(30),
      }),
    )

    const cancel = { ...subscription, type: 'subscription.canceled', accessEndsAt: at(30) } as const
    const first = await billing.handleWebhook(driver.webhook({ ...cancel, occurredAt: at(1) }))
    const second = await billing.handleWebhook(driver.webhook({ ...cancel, occurredAt: at(2) }))

    expect(first.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect(second.response.status).toBe(200)
    expect(second.events).toEqual([])
    expect(second.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    // The second event still counts as the newest one of the holding.
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      updatedAt: at(2),
    })

    // A refund reported twice keeps the date of the first report.
    const refund = { ...subscription, type: 'payment.refunded' } as const
    await billing.handleWebhook(driver.webhook({ ...refund, occurredAt: at(3) }))
    const repeated = await billing.handleWebhook(driver.webhook({ ...refund, occurredAt: at(4) }))
    expect(repeated.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'refunded',
      accessEndsAt: at(3),
    })
  })

  it('takes a failed payment back when the provider says the subscription runs again', async () => {
    const { billing, driver } = await setup()
    const subscription = { userId: 'u1', providerId: 'pri_pro', holdingId: 'sub_1' }
    await billing.handleWebhook(
      driver.webhook([
        { ...subscription, type: 'subscription.started', occurredAt: at(0) },
        { ...subscription, type: 'payment.failed', occurredAt: at(30) },
      ]),
    )
    expect((await billing.account('u1')).holdings[0]?.status).toBe('past_due')

    await billing.handleWebhook(
      driver.webhook({ ...subscription, type: 'subscription.changed', occurredAt: at(31) }),
    )
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')

    // A refund stays a refund until a renewal is paid.
    await billing.handleWebhook(
      driver.webhook([
        { ...subscription, type: 'payment.refunded', occurredAt: at(32) },
        { ...subscription, type: 'subscription.changed', occurredAt: at(33) },
      ]),
    )
    expect((await billing.account('u1')).holdings[0]?.status).toBe('refunded')
    await billing.handleWebhook(
      driver.webhook({ ...subscription, type: 'subscription.renewed', occurredAt: at(60) }),
    )
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
  })

  it('takes the product of the holding for an event that names only its purchase', async () => {
    const { billing, driver } = await setup()
    const refund = { type: 'payment.refunded', holdingId: 'txn_1', customerId: 'ctm_1' } as const

    // Nobody knows the purchase yet: the provider is asked to deliver again.
    const early = await billing.handleWebhook(driver.webhook({ ...refund, id: 'evt_r' }))
    expect(early.response.status).toBe(409)
    expect(early.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])

    // The customer is known, the purchase still is not.
    await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        userId: 'u1',
        customerId: 'ctm_1',
        providerId: 'pri_pro',
        holdingId: 'sub_1',
        occurredAt: at(0),
      }),
    )
    const stillEarly = await billing.handleWebhook(driver.webhook({ ...refund, id: 'evt_r' }))
    expect(stillEarly.response.status).toBe(409)
    expect((await billing.account('u1')).holdings).toHaveLength(1)

    await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        userId: 'u1',
        providerId: 'pri_unlock',
        holdingId: 'txn_1',
        occurredAt: at(1),
      }),
    )
    const delivered = await billing.handleWebhook(
      driver.webhook({ ...refund, id: 'evt_r', occurredAt: at(2) }),
    )

    expect(delivered.response.status).toBe(200)
    expect(delivered.events).toEqual([
      expect.objectContaining({
        type: 'payment.refunded',
        userId: 'u1',
        product: 'unlock',
        holdingId: 'txn_1',
      }),
    ])
    const { holdings } = await billing.account('u1')
    expect(holdings.find((holding) => holding.id === 'txn_1')).toMatchObject({
      type: 'one-time',
      status: 'refunded',
    })
    expect(holdings.find((holding) => holding.id === 'sub_1')?.status).toBe('active')
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

  /** A subscription and a one-time purchase of one user, each with the ids a provider knows them by */
  async function bought(
    billing: Awaited<ReturnType<typeof setup>>['billing'],
    driver: Awaited<ReturnType<typeof setup>>['driver'],
    userId: string,
  ) {
    await billing.handleWebhook(
      driver.webhook([
        {
          type: 'subscription.started',
          id: `evt_sub_${userId}`,
          userId,
          customerId: `cus_${userId}`,
          providerId: 'pri_pro',
          holdingId: `sub_${userId}`,
          occurredAt: at(0),
          currentPeriodEnd: at(30),
        },
        {
          type: 'purchase.completed',
          id: `evt_txn_${userId}`,
          userId,
          customerId: `cus_${userId}`,
          providerId: 'pri_unlock',
          holdingId: `txn_${userId}`,
          occurredAt: at(1),
        },
      ]),
    )
  }

  it('forgets a user: the account, what was given by hand, and every link to them', async () => {
    const { billing, driver, store } = await setup()
    await bought(billing, driver, 'u1')
    await billing.grant('u1', 'team')
    expect((await billing.entitlements('u1')).products.sort()).toEqual(['pro', 'team', 'unlock'])

    await billing.forget('u1')

    expect(await store.getAccount('u1')).toBeNull()
    expect(await billing.account('u1')).toEqual({
      userId: 'u1',
      customers: {},
      holdings: [],
      grants: [],
    })
    expect((await billing.entitlements('u1')).products).toEqual([])
    expect(await store.findUserId('holding', 'fake:sub_u1')).toBeNull()
    expect(await store.findUserId('holding', 'fake:txn_u1')).toBeNull()
    expect(await store.findUserId('customer', 'fake:cus_u1')).toBeNull()
  })

  it('forgets nothing of another user', async () => {
    const { billing, driver, store } = await setup()
    await bought(billing, driver, 'u1')
    await bought(billing, driver, 'u2')
    await billing.grant('u2', 'team')
    const before = await billing.account('u2')

    await billing.forget('u1')

    expect(await billing.account('u2')).toEqual(before)
    expect(await store.findUserId('holding', 'fake:sub_u2')).toBe('u2')
    expect(await store.findUserId('holding', 'fake:txn_u2')).toBe('u2')
    expect(await store.findUserId('customer', 'fake:cus_u2')).toBe('u2')
    // A refund that names only the purchase still finds its user.
    const refund = await billing.handleWebhook(
      driver.webhook({ type: 'payment.refunded', id: 'evt_refund', holdingId: 'txn_u2' }),
    )
    expect(refund.events).toEqual([
      expect.objectContaining({ type: 'payment.refunded', userId: 'u2', product: 'unlock' }),
    ])
  })

  it('finds no user any more for an event that names only what a forgotten user held', async () => {
    const { billing, driver, store } = await setup()
    await bought(billing, driver, 'u1')
    await billing.forget('u1')

    const byHolding = await billing.handleWebhook(
      driver.webhook({ type: 'payment.refunded', id: 'evt_1', holdingId: 'txn_u1' }),
    )
    const byCustomer = await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.renewed',
        id: 'evt_2',
        customerId: 'cus_u1',
        providerId: 'pri_pro',
        holdingId: 'sub_new',
      }),
    )

    expect(byHolding.events).toEqual([])
    expect(byHolding.skipped.map((skip) => skip.reason)).toEqual(['unmatched'])
    expect(byCustomer.events).toEqual([])
    expect(byCustomer.skipped.map((skip) => skip.reason)).toEqual(['unmatched'])
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('starts the account anew when an event names a forgotten user', async () => {
    const { billing, driver, store } = await setup()
    await bought(billing, driver, 'u1')
    await billing.forget('u1')

    // Nothing remembers that this event was applied before: the provider is the one to stop.
    const again = await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        id: 'evt_sub_u1',
        userId: 'u1',
        customerId: 'cus_u1',
        providerId: 'pri_pro',
        holdingId: 'sub_u1',
        occurredAt: at(0),
        currentPeriodEnd: at(30),
      }),
    )

    expect(again.events).toEqual([expect.objectContaining({ id: 'evt_sub_u1', userId: 'u1' })])
    expect((await billing.account('u1')).holdings.map((holding) => holding.id)).toEqual(['sub_u1'])
    expect(await store.findUserId('holding', 'fake:sub_u1')).toBe('u1')

    await billing.forget('u1')
    expect(await store.getAccount('u1')).toBeNull()
    expect(await store.findUserId('holding', 'fake:sub_u1')).toBeNull()
  })

  it('forgets a user it has never seen without an error, and any user twice', async () => {
    const { billing, driver, store } = await setup()

    await expect(billing.forget('nobody')).resolves.toBeUndefined()
    expect(await store.getAccount('nobody')).toBeNull()

    await bought(billing, driver, 'u1')
    await billing.forget('u1')
    await expect(billing.forget('u1')).resolves.toBeUndefined()
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('forgets a user who only got something by hand', async () => {
    const { billing, store } = await setup()
    await billing.grant('u1', 'pro')

    await billing.forget('u1')

    expect(await store.getAccount('u1')).toBeNull()
    expect((await billing.entitlements('u1')).products).toEqual([])
  })

  it('leaves a link that leads to another user', async () => {
    const { billing, driver, store } = await setup()
    await bought(billing, driver, 'u1')
    // The provider reports a purchase of u1 for u2 as well: the first link of an id stays.
    await billing.handleWebhook(
      driver.webhook({
        type: 'purchase.completed',
        id: 'evt_other',
        userId: 'u2',
        customerId: 'cus_u1',
        providerId: 'pri_unlock',
        holdingId: 'txn_u1',
        occurredAt: at(2),
      }),
    )
    expect((await billing.account('u2')).holdings.map((holding) => holding.id)).toEqual(['txn_u1'])

    await billing.forget('u2')

    expect(await store.getAccount('u2')).toBeNull()
    expect(await store.findUserId('holding', 'fake:txn_u1')).toBe('u1')
    expect(await store.findUserId('customer', 'fake:cus_u1')).toBe('u1')
    expect((await billing.account('u1')).holdings).toHaveLength(2)
  })

  it('forgets one of the users whose ids differ only in case or contain path characters', async () => {
    const { billing, driver, store } = await setup()
    const ids = ['Abc', 'abc', '../abc', 'a/b', 'a']
    for (const userId of ids) await bought(billing, driver, userId)

    await billing.forget('Abc')
    await billing.forget('../abc')
    await billing.forget('a/b')

    for (const userId of ['Abc', '../abc', 'a/b']) {
      expect(await store.getAccount(userId)).toBeNull()
      expect(await store.findUserId('holding', `fake:sub_${userId}`)).toBeNull()
    }
    for (const userId of ['abc', 'a']) {
      expect((await billing.account(userId)).holdings).toHaveLength(2)
      expect(await store.findUserId('holding', `fake:sub_${userId}`)).toBe(userId)
      expect(await store.findUserId('customer', `fake:cus_${userId}`)).toBe(userId)
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
    await expect(billing.forget('')).rejects.toThrow(/userId must be a non-empty string/)
  })

  it('tells no provider that a user is forgotten', async () => {
    const { billing, driver } = setup()
    await billing.handleWebhook(
      driver.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
    )
    const calls = vi.fn()
    const watched = createBilling({
      driver: new Proxy(driver, {
        get(target, name, receiver) {
          const value: unknown = Reflect.get(target, name, receiver)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            calls(name)
            return Reflect.apply(value, target, args)
          }
        },
      }),
      store: createMemoryBillingStore(),
      products,
    })
    await watched.handleWebhook(
      driver.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
    )
    calls.mockClear()

    await watched.forget('u1')

    expect(calls).not.toHaveBeenCalled()
    expect((await watched.account('u1')).holdings).toEqual([])
  })

  it('lets what the store throws leave forget', async () => {
    const store: BillingStore = {
      ...createMemoryBillingStore(),
      async forget() {
        throw new Error('store down')
      },
    }
    const billing = createBilling({ driver: createFakeBillingDriver(), store, products })

    await expect(billing.forget('u1')).rejects.toThrow('store down')
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
        // @ts-expect-error 'stripe' is not built in
        driver: 'stripe',
        store: createMemoryBillingStore(),
        products,
      }),
    ).toThrow(/unknown driver "stripe"/)
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
        adapter: { read: async () => null, delete: async () => {} },
      }),
    ).toThrow(/readVersioned\/writeIf/)
  })

  /** Every file below a folder of a `MemoryAdapter`, with its path from the root */
  async function filesIn(adapter: MemoryAdapter, folder: string): Promise<string[]> {
    const files: string[] = []
    for (const name of await adapter.list(folder)) {
      const path = `${folder}/${name}`
      if (name.endsWith('.json')) files.push(path)
      else files.push(...(await filesIn(adapter, path)))
    }
    return files.sort()
  }

  async function withTwoUsers() {
    const adapter = new MemoryAdapter()
    const driver = createFakeBillingDriver()
    const store = createFlatdbBillingStore({ adapter, prefix: 'pay' })
    const billing = createBilling({ driver, store, products })
    for (const userId of ['User 1', 'u2']) {
      await billing.handleWebhook(
        driver.webhook([
          {
            type: 'subscription.started',
            userId,
            customerId: `cus_${userId}`,
            providerId: 'pri_pro',
            holdingId: `sub_${userId}`,
            occurredAt: at(0),
          },
          {
            type: 'purchase.completed',
            userId,
            customerId: `cus_${userId}`,
            providerId: 'pri_unlock',
            holdingId: `txn_${userId}`,
            occurredAt: at(1),
          },
        ]),
      )
    }
    return { adapter, driver, store, billing }
  }

  it('forgets a user by deleting the account file and the link files, and no other file', async () => {
    const { adapter, billing } = await withTwoUsers()
    await adapter.write('pay.json', '{}')
    expect(await filesIn(adapter, 'pay')).toEqual([
      'pay/accounts/u2.json',
      'pay/accounts/~55ser~201.json',
      'pay/refs/customer/fake~3acus_u2.json',
      'pay/refs/customer/fake~3acus_~55ser~201.json',
      'pay/refs/holding/fake~3asub_u2.json',
      'pay/refs/holding/fake~3asub_~55ser~201.json',
      'pay/refs/holding/fake~3atxn_u2.json',
      'pay/refs/holding/fake~3atxn_~55ser~201.json',
    ])

    await billing.forget('User 1')

    expect(await filesIn(adapter, 'pay')).toEqual([
      'pay/accounts/u2.json',
      'pay/refs/customer/fake~3acus_u2.json',
      'pay/refs/holding/fake~3asub_u2.json',
      'pay/refs/holding/fake~3atxn_u2.json',
    ])
    expect(await adapter.read('pay.json')).toBe('{}')
  })

  it('deletes the links before the account, so a forget that stopped halfway can be repeated', async () => {
    const { adapter, driver } = await withTwoUsers()
    const deleted: string[] = []
    let failAt = 2
    const store = createFlatdbBillingStore({
      prefix: 'pay',
      adapter: {
        read: (path) => adapter.read(path),
        readVersioned: (path) => adapter.readVersioned(path),
        writeIf: (path, data, version) => adapter.writeIf(path, data, version),
        async delete(path) {
          if (deleted.length === failAt) throw new Error('storage down')
          deleted.push(path)
          await adapter.delete(path)
        },
      },
    })
    const billing = createBilling({ driver, store, products })

    await expect(billing.forget('u2')).rejects.toThrow('storage down')
    // The account is still there, and it still names what is left to delete.
    expect(await adapter.read('pay/accounts/u2.json')).not.toBeNull()
    expect(deleted).toHaveLength(2)

    failAt = -1
    await billing.forget('u2')

    expect(deleted.at(-1)).toBe('pay/accounts/u2.json')
    expect(deleted.slice(0, -1).every((path) => path.startsWith('pay/refs/'))).toBe(true)
    expect((await filesIn(adapter, 'pay')).filter((path) => path.includes('u2'))).toEqual([])
  })

  it('forgets an account file it refuses to read', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbBillingStore({ adapter })
    const link = JSON.stringify({ userId: 'old' })
    // As fullstack 0.7 wrote it: the holdings name no provider.
    await adapter.write(
      'billing/accounts/old.json',
      JSON.stringify({
        userId: 'old',
        customerId: 'cus_1',
        holdings: [{ id: 'sub_1', product: 'pro', type: 'subscription', status: 'active' }],
        appliedEvents: ['evt_1'],
      }),
    )
    // Half of it can still be told.
    await adapter.write(
      'billing/accounts/mixed.json',
      JSON.stringify({
        userId: 'mixed',
        customers: { fake: 'cus_2', broken: 7 },
        holdings: [
          { provider: 'fake', id: 'sub_2' },
          { provider: 'fake', id: 'x'.repeat(300) },
          { provider: 'fake' },
          'not a holding',
        ],
      }),
    )
    await adapter.write(
      'billing/refs/customer/fake~3acus_2.json',
      JSON.stringify({ userId: 'mixed' }),
    )
    await adapter.write(
      'billing/refs/holding/fake~3asub_2.json',
      JSON.stringify({ userId: 'mixed' }),
    )
    await adapter.write('billing/refs/holding/fake~3asub_3.json', link)
    await adapter.write('billing/accounts/garbage.json', 'not json')
    await adapter.write('billing/accounts/list.json', '[]')
    for (const userId of ['old', 'mixed', 'garbage', 'list']) {
      await expect(store.getAccount(userId)).rejects.toThrow()
    }

    for (const userId of ['old', 'mixed', 'garbage', 'list']) await store.forget(userId)

    expect(await filesIn(adapter, 'billing')).toEqual(['billing/refs/holding/fake~3asub_3.json'])
    for (const userId of ['old', 'mixed', 'garbage', 'list']) {
      expect(await store.getAccount(userId)).toBeNull()
    }
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
      customers: { fake: 'cus_1' },
      holdings: [
        {
          provider: 'fake',
          id: 'sub_1',
          product: 'pro',
          type: 'subscription',
          status: 'active',
          startedAt: at(0).toISOString(),
          currentPeriodEnd: at(30).toISOString(),
          accessEndsAt: null,
          pastDueSince: null,
          updatedAt: at(0).toISOString(),
        },
      ],
      grants: [],
      appliedEvents: ['fake:evt_1'],
    })
    // Every id a store links carries the name of its provider in front.
    expect(JSON.parse((await adapter.read('pay/refs/holding/fake~3asub_1.json'))!)).toEqual({
      userId: 'User 1',
    })
    expect(JSON.parse((await adapter.read('pay/refs/customer/fake~3acus_1.json'))!)).toEqual({
      userId: 'User 1',
    })
  })

  it('refuses an account whose holdings name no provider, as fullstack 0.7 wrote them', async () => {
    const adapter = new MemoryAdapter()
    const holding = {
      id: 'sub_1',
      product: 'pro',
      type: 'subscription',
      status: 'active',
      startedAt: at(0).toISOString(),
      currentPeriodEnd: null,
      accessEndsAt: null,
      pastDueSince: null,
      updatedAt: at(0).toISOString(),
    }
    const written = { customerId: 'cus_1', grants: [], appliedEvents: ['evt_1'] }
    await adapter.write(
      'billing/accounts/paid.json',
      JSON.stringify({ ...written, userId: 'paid', holdings: [holding] }),
    )
    await adapter.write(
      'billing/accounts/gifted.json',
      JSON.stringify({
        ...written,
        userId: 'gifted',
        customerId: null,
        holdings: [],
        grants: [{ product: 'pro', grantedAt: at(0).toISOString(), until: null }],
      }),
    )
    const store = createFlatdbBillingStore({ adapter })
    const billing = createBilling({ driver: createFakeBillingDriver(), store, products })

    // Nobody can tell from the file who sold the subscription: no guess, no access by mistake.
    await expect(billing.entitlements('paid')).rejects.toThrow(/names no provider/)
    await expect(store.getAccount('paid')).rejects.toThrow(/Coming from 0\.7/)
    await expect(store.transact('paid', (account) => ({ account, result: 1 }))).rejects.toThrow(
      BillingError,
    )
    // An account without purchases has nothing to tell apart: what was given by hand stays.
    expect(await billing.account('gifted')).toMatchObject({
      customers: {},
      holdings: [],
      grants: [{ product: 'pro' }],
    })
  })

  it('reads a store of fullstack 0.7 once it is rewritten as the docs say', async () => {
    const adapter = new MemoryAdapter()
    // What 0.7 wrote for one subscription of one user, with `driver: 'paddle'`.
    const old = {
      'billing/accounts/u1.json': {
        userId: 'u1',
        customerId: 'ctm_1',
        holdings: [
          {
            id: 'sub_1',
            product: 'pro',
            type: 'subscription',
            status: 'active',
            startedAt: at(0).toISOString(),
            currentPeriodEnd: at(30).toISOString(),
            accessEndsAt: null,
            pastDueSince: null,
            updatedAt: at(0).toISOString(),
          },
        ],
        grants: [],
        appliedEvents: ['evt_1'],
      },
      'billing/refs/holding/sub_1.json': { userId: 'u1' },
      'billing/refs/customer/ctm_1.json': { userId: 'u1' },
    }

    // The rewrite of "Coming from 0.7", for the provider `paddle`.
    const provider = 'paddle'
    for (const [path, doc] of Object.entries(old)) {
      if ('holdings' in doc) {
        const { customerId, ...account } = doc
        await adapter.write(
          path,
          JSON.stringify({
            ...account,
            customers: { [provider]: customerId },
            holdings: account.holdings.map((holding) => ({ ...holding, provider })),
            appliedEvents: account.appliedEvents.map((id) => `${provider}:${id}`),
          }),
        )
      } else {
        const file = path.slice(path.lastIndexOf('/') + 1)
        await adapter.write(
          `${path.slice(0, -file.length)}${provider}~3a${file}`,
          JSON.stringify(doc),
        )
      }
    }

    const driver = createFakeBillingDriver()
    const billing = createBilling({
      driver: { ...driver, name: 'paddle' },
      store: createFlatdbBillingStore({ adapter }),
      products,
    })

    expect(await billing.account('u1')).toMatchObject({
      customers: { paddle: 'ctm_1' },
      holdings: [{ provider: 'paddle', id: 'sub_1', status: 'active' }],
    })
    // The event 0.7 applied is known, and a refund that names only the subscription finds it.
    const again = await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        id: 'evt_1',
        userId: 'u1',
        providerId: 'pri_pro',
        holdingId: 'sub_1',
        occurredAt: at(0),
      }),
    )
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    const refund = await billing.handleWebhook(
      driver.webhook({ type: 'payment.refunded', holdingId: 'sub_1', occurredAt: at(5) }),
    )
    expect(refund.events).toEqual([
      expect.objectContaining({ provider: 'paddle', userId: 'u1', product: 'pro' }),
    ])
    // A new subscription of the customer 0.7 knew.
    const next = await billing.handleWebhook(
      driver.webhook({
        type: 'subscription.started',
        customerId: 'ctm_1',
        providerId: 'pri_team',
        holdingId: 'sub_2',
        occurredAt: at(6),
      }),
    )
    expect(next.events).toEqual([expect.objectContaining({ userId: 'u1', product: 'team' })])
  })

  it('gives up with an error when it keeps losing against other writers', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbBillingStore({
      adapter: {
        read: (path) => adapter.read(path),
        delete: (path) => adapter.delete(path),
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
