import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsAdapter, MemoryAdapter } from '@loewen-digital/flatdb'
import {
  BillingError,
  BillingPurchaseError,
  createBilling,
  createMemoryBillingStore,
} from '../index.js'
import type { BillingDriver, BillingStore, ProviderEvent } from '../index.js'
import { createFlatdbBillingStore } from '../stores/flatdb.js'
import { createFakeBillingDriver } from '../../testing/index.js'
import type { FakeBillingEvent } from '../../testing/index.js'

// Sold on the web and in the app of a store; one thing only in the app, one only given by hand.
const products = {
  unlock: {
    type: 'one-time',
    providerId: { web: 'pri_unlock', app: 'com.app.unlock' },
    features: ['themes'],
  },
  pro: {
    type: 'subscription',
    providerId: { web: 'pri_pro', app: 'com.app.pro' },
    features: ['themes', 'export'],
  },
  credits: { type: 'one-time', providerId: { app: 'com.app.credits' } },
  gift: { type: 'one-time', providerId: {}, features: ['themes'] },
} as const

const at = (minute: number): Date => new Date(Date.UTC(2026, 10, 17, 12, minute))

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

describe.each(stores)('several providers on the %s', (_name, createStore) => {
  async function setup() {
    const web = createFakeBillingDriver()
    const app = createFakeBillingDriver()
    const onError = vi.fn()
    const store = await createStore()
    const billing = createBilling({ drivers: { web, app }, store, products, onError })
    return { billing, web, app, store, onError }
  }

  it('starts a checkout at the provider it names, with that provider’s id of the product', async () => {
    const { billing, web, app } = await setup()

    await billing.checkout({ provider: 'app', userId: 'u1', product: 'pro' })

    expect(app.checkouts.map((checkout) => checkout.providerId)).toEqual(['com.app.pro'])
    expect(web.checkouts).toEqual([])
  })

  it('refuses a call that does not say which provider, an unknown one, and a product not sold there', async () => {
    const { billing } = await setup()

    await expect(billing.checkout({ userId: 'u1', product: 'pro' })).rejects.toThrow(
      /several drivers \(web, app\)/,
    )
    await expect(billing.manageUrl('u1')).rejects.toThrow(/several drivers/)
    await expect(
      // @ts-expect-error 'shop' is not a provider of the config
      billing.checkout({ provider: 'shop', userId: 'u1', product: 'pro' }),
    ).rejects.toThrow(/unknown provider "shop"/)
    await expect(
      billing.checkout({ provider: 'web', userId: 'u1', product: 'credits' }),
    ).rejects.toThrow(/"credits" is not sold through "web"/)
    await expect(
      billing.checkout({ provider: 'app', userId: 'u1', product: 'gift' }),
    ).rejects.toThrow(BillingError)
  })

  it('hands each webhook to the driver it belongs to, and says on the holding who sold it', async () => {
    const { billing, web, app } = await setup()

    const fromWeb = await billing.handleWebhook(
      web.webhook({
        type: 'subscription.started',
        id: 'evt_1',
        userId: 'u1',
        customerId: 'cus_web',
        providerId: 'pri_pro',
        holdingId: 'sub_1',
        occurredAt: at(0),
      }),
      { provider: 'web' },
    )
    const fromApp = await billing.handleWebhook(
      app.webhook({
        type: 'purchase.completed',
        id: 'evt_2',
        userId: 'u1',
        customerId: 'cus_app',
        providerId: 'com.app.unlock',
        holdingId: 'txn_1',
        occurredAt: at(1),
      }),
      { provider: 'app' },
    )

    expect(fromWeb.events).toEqual([expect.objectContaining({ provider: 'web', product: 'pro' })])
    expect(fromApp.events).toEqual([
      expect.objectContaining({ provider: 'app', product: 'unlock' }),
    ])
    const account = await billing.account('u1')
    expect(account.customers).toEqual({ web: 'cus_web', app: 'cus_app' })
    expect(
      account.holdings.map(({ provider, id, product }) => ({ provider, id, product })),
    ).toEqual([
      { provider: 'web', id: 'sub_1', product: 'pro' },
      { provider: 'app', id: 'txn_1', product: 'unlock' },
    ])

    // The next checkout at each provider goes along with the customer the user is there.
    await billing.checkout({ provider: 'web', userId: 'u1', product: 'unlock' })
    await billing.checkout({ provider: 'app', userId: 'u1', product: 'pro' })
    expect(web.checkouts[0]?.customerId).toBe('cus_web')
    expect(app.checkouts[0]?.customerId).toBe('cus_app')
  })

  it('answers 500 and reports a webhook nobody said the provider of', async () => {
    const { billing, web, onError, store } = await setup()

    const { response, events } = await billing.handleWebhook(
      web.webhook({ type: 'purchase.completed', userId: 'u1', providerId: 'pri_unlock' }),
    )

    expect(response.status).toBe(500)
    expect(events).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('keeps the ids of two providers apart, also when they are the same', async () => {
    const { billing, web, app } = await setup()
    const same = { type: 'purchase.completed', id: 'evt_1', holdingId: 'id_1' } as const

    // The same event id and the same purchase id, at two providers and for two users.
    await billing.handleWebhook(
      web.webhook({ ...same, userId: 'u1', providerId: 'pri_unlock', occurredAt: at(0) }),
      { provider: 'web' },
    )
    const second = await billing.handleWebhook(
      app.webhook({ ...same, userId: 'u2', providerId: 'com.app.unlock', occurredAt: at(0) }),
      { provider: 'app' },
    )
    expect(second.events).toHaveLength(1)

    // And for one user: two events, two holdings.
    const third = await billing.handleWebhook(
      app.webhook({
        ...same,
        id: 'evt_9',
        holdingId: 'id_9',
        userId: 'u1',
        providerId: 'com.app.unlock',
      }),
      { provider: 'app' },
    )
    const fourth = await billing.handleWebhook(
      web.webhook({
        ...same,
        id: 'evt_9',
        holdingId: 'id_9',
        userId: 'u1',
        providerId: 'pri_unlock',
      }),
      { provider: 'web' },
    )
    expect(third.events).toHaveLength(1)
    expect(fourth.events).toHaveLength(1)
    expect(fourth.skipped).toEqual([])
    expect(
      (await billing.account('u1')).holdings.map(({ provider, id }) => `${provider} ${id}`),
    ).toEqual(['web id_1', 'app id_9', 'web id_9'])

    // A refund that names only its purchase finds the user of that provider's purchase.
    const refund = await billing.handleWebhook(
      app.webhook({ type: 'payment.refunded', holdingId: 'id_1', occurredAt: at(5) }),
      { provider: 'app' },
    )
    expect(refund.events).toEqual([
      expect.objectContaining({ provider: 'app', userId: 'u2', product: 'unlock' }),
    ])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      provider: 'web',
      id: 'id_1',
      status: 'active',
    })
  })

  it('skips an event that carries the product id of another provider', async () => {
    const { billing, web } = await setup()

    const { response, skipped } = await billing.handleWebhook(
      web.webhook({ type: 'purchase.completed', userId: 'u1', providerId: 'com.app.unlock' }),
      { provider: 'web' },
    )

    expect(response.status).toBe(200)
    expect(skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('grants a product while either of two holdings of it is active', async () => {
    const { billing, web, app } = await setup()
    await billing.handleWebhook(
      web.webhook({
        type: 'subscription.started',
        userId: 'u1',
        providerId: 'pri_pro',
        holdingId: 'sub_web',
        occurredAt: at(0),
        currentPeriodEnd: at(30),
      }),
      { provider: 'web' },
    )
    await billing.handleWebhook(
      app.webhook({
        type: 'subscription.started',
        userId: 'u1',
        providerId: 'com.app.pro',
        holdingId: 'sub_app',
        occurredAt: at(1),
        currentPeriodEnd: at(31),
      }),
      { provider: 'app' },
    )

    const both = await billing.entitlements('u1', { now: at(2) })
    expect(both.products).toEqual(['pro'])
    expect((await billing.account('u1')).holdings).toHaveLength(2)

    // The one from the web ends: the one from the app still grants.
    await billing.handleWebhook(
      web.webhook({
        type: 'subscription.canceled',
        userId: 'u1',
        providerId: 'pri_pro',
        holdingId: 'sub_web',
        occurredAt: at(3),
        accessEndsAt: at(3),
      }),
      { provider: 'web' },
    )
    expect((await billing.entitlements('u1', { now: at(4) })).has('export')).toBe(true)

    await billing.handleWebhook(
      app.webhook({ type: 'payment.refunded', holdingId: 'sub_app', occurredAt: at(5) }),
      { provider: 'app' },
    )
    const neither = await billing.entitlements('u1', { now: at(6) })
    expect(neither.has('export')).toBe(false)
    expect(neither.products).toEqual([])
  })

  it('asks the provider of a holding for the manage link, with what the user holds there', async () => {
    const { billing, web, app } = await setup()
    await billing.handleWebhook(
      web.webhook({
        type: 'subscription.started',
        userId: 'u1',
        customerId: 'cus_web',
        providerId: 'pri_pro',
        holdingId: 'sub_web',
      }),
      { provider: 'web' },
    )
    await billing.handleWebhook(
      app.webhook({
        type: 'subscription.started',
        userId: 'u1',
        providerId: 'com.app.pro',
        holdingId: 'sub_app',
      }),
      { provider: 'app' },
    )

    const { holdings } = await billing.account('u1')
    const links = await Promise.all(
      holdings.map((holding) =>
        billing.manageUrl('u1', { provider: holding.provider, returnUrl: '/me' }),
      ),
    )

    expect(links).toEqual([
      'https://fake-billing.test/manage/u1',
      'https://fake-billing.test/manage/u1',
    ])
    expect(web.manageRequests).toEqual([
      {
        userId: 'u1',
        customerId: 'cus_web',
        holdings: [expect.objectContaining({ provider: 'web', id: 'sub_web' })],
        providerIds: { unlock: 'pri_unlock', pro: 'pri_pro' },
        returnUrl: '/me',
      },
    ])
    expect(app.manageRequests).toEqual([
      {
        userId: 'u1',
        customerId: null,
        holdings: [expect.objectContaining({ provider: 'app', id: 'sub_app' })],
        providerIds: {
          unlock: 'com.app.unlock',
          pro: 'com.app.pro',
          credits: 'com.app.credits',
        },
        returnUrl: '/me',
      },
    ])
  })
})

describe.each(stores)('a purchase made on the device, on the %s', (_name, createStore) => {
  async function setup() {
    const web = createFakeBillingDriver()
    const app = createFakeBillingDriver()
    const store = await createStore()
    const billing = createBilling({ drivers: { web, app }, store, products })
    const unlock = (extra: object = {}) =>
      app.proof({
        type: 'purchase.completed',
        id: 'evt_unlock',
        providerId: 'com.app.unlock',
        holdingId: 'txn_1',
        occurredAt: at(0),
        ...extra,
      })
    return { billing, web, app, store, unlock }
  }

  it('applies what the verified proof says for the user who hands it over', async () => {
    const { billing, app, unlock } = await setup()

    const { events, skipped } = await billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: unlock({ customerId: 'acct_u1' }),
    })

    expect(skipped).toEqual([])
    expect(events).toEqual([
      {
        type: 'purchase.completed',
        id: 'evt_unlock',
        provider: 'app',
        occurredAt: at(0),
        userId: 'u1',
        product: 'unlock',
        holdingId: 'txn_1',
      },
    ])
    expect(await billing.account('u1')).toMatchObject({
      customers: { app: 'acct_u1' },
      holdings: [{ provider: 'app', id: 'txn_1', product: 'unlock', status: 'active' }],
    })
    expect((await billing.entitlements('u1')).has('themes')).toBe(true)
    // What the driver was handed: the user, and what the config sells through this provider.
    expect(app.purchases).toHaveLength(1)
    expect(app.purchases[0]).toMatchObject({
      userId: 'u1',
      customerId: null,
      products: {
        'com.app.unlock': { product: 'unlock', type: 'one-time' },
        'com.app.pro': { product: 'pro', type: 'subscription' },
        'com.app.credits': { product: 'credits', type: 'one-time' },
      },
    })
  })

  it('applies a proof once, however often and however fast it is handed over', async () => {
    const { billing, unlock } = await setup()
    const proof = unlock()

    const first = await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof })
    const again = await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof })
    expect(first.events).toHaveLength(1)
    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])

    const credits = billing.verifyPurchase.bind(billing, {
      provider: 'app',
      userId: 'u1',
      proof: unlock({ id: 'evt_credits', providerId: 'com.app.credits', holdingId: 'txn_2' }),
    })
    const results = await Promise.all(Array.from({ length: 20 }, () => credits()))
    expect(results.flatMap((result) => result.events)).toHaveLength(1)
    expect((await billing.account('u1')).holdings).toHaveLength(2)
  })

  it('counts an event once when the proof and a webhook both tell it', async () => {
    const { billing, app, unlock } = await setup()
    const told = {
      type: 'purchase.completed',
      id: 'evt_unlock',
      userId: 'u1',
      providerId: 'com.app.unlock',
      holdingId: 'txn_1',
      occurredAt: at(0),
    } as const

    // The proof first, then the provider's notification of the same purchase.
    const proof = await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof: unlock() })
    const notified = await billing.handleWebhook(app.webhook(told), { provider: 'app' })
    expect(proof.events).toHaveLength(1)
    expect(notified.response.status).toBe(200)
    expect(notified.events).toEqual([])
    expect(notified.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])

    // The notification first, with an id of its own: the proof finds the purchase as it says.
    await billing.handleWebhook(
      app.webhook({ ...told, id: 'ntf_2', userId: 'u2', holdingId: 'txn_2' }),
      { provider: 'app' },
    )
    const late = await billing.verifyPurchase({
      provider: 'app',
      userId: 'u2',
      proof: unlock({ id: 'evt_from_proof', holdingId: 'txn_2', occurredAt: at(1) }),
    })
    expect(late.events).toEqual([])
    expect(late.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect((await billing.account('u2')).holdings).toHaveLength(1)
  })

  it('lets a later webhook that names only the purchase find the user of the proof', async () => {
    const { billing, app, unlock } = await setup()
    await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof: unlock() })

    const refund = await billing.handleWebhook(
      app.webhook({ type: 'payment.refunded', holdingId: 'txn_1', occurredAt: at(9) }),
      { provider: 'app' },
    )

    expect(refund.response.status).toBe(200)
    expect(refund.events).toEqual([
      expect.objectContaining({ type: 'payment.refunded', userId: 'u1', product: 'unlock' }),
    ])
    expect((await billing.entitlements('u1')).has('themes')).toBe(false)
  })

  it('refuses the purchase of another user and changes nothing', async () => {
    const { billing, store, unlock } = await setup()
    await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof: unlock() })

    const stolen = billing.verifyPurchase({ provider: 'app', userId: 'u2', proof: unlock() })

    await expect(stolen).rejects.toThrow(BillingPurchaseError)
    await expect(stolen).rejects.toMatchObject({ reason: 'other-user' })
    await expect(stolen).rejects.toThrow(/belongs to another user/)
    await expect(stolen).rejects.not.toThrow(/txn_1/)
    expect(await store.getAccount('u2')).toBeNull()
    expect((await billing.entitlements('u2')).has('themes')).toBe(false)
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('refuses a proof that names another user than the one who hands it over', async () => {
    const { billing, store, unlock } = await setup()

    const foreign = billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: unlock({ userId: 'u9' }),
    })

    await expect(foreign).rejects.toMatchObject({ reason: 'other-user' })
    expect(await store.getAccount('u1')).toBeNull()
    // Nothing was linked to the one who tried: the owner still gets it.
    const owner = await billing.verifyPurchase({
      provider: 'app',
      userId: 'u9',
      proof: unlock({ userId: 'u9' }),
    })
    expect(owner.events).toHaveLength(1)
  })

  it('refuses a customer of the provider who is linked to another user', async () => {
    const { billing, store, unlock } = await setup()
    await billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: unlock({ customerId: 'acct_1' }),
    })

    const other = billing.verifyPurchase({
      provider: 'app',
      userId: 'u2',
      proof: unlock({ id: 'evt_b', holdingId: 'txn_b', customerId: 'acct_1' }),
    })

    await expect(other).rejects.toMatchObject({ reason: 'other-user' })
    expect(await store.getAccount('u2')).toBeNull()
  })

  it('applies none of a proof when one of its purchases is another user’s', async () => {
    const { billing, app, store, unlock } = await setup()
    await billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: unlock({ id: 'evt_old', holdingId: 'sub_old', providerId: 'com.app.pro' }),
    })

    // What a store tells for an upgrade: the old subscription ends, a new one starts.
    const mixed = billing.verifyPurchase({
      provider: 'app',
      userId: 'u2',
      proof: app.proof([
        {
          type: 'subscription.started',
          id: 'evt_new',
          providerId: 'com.app.pro',
          holdingId: 'sub_new',
          occurredAt: at(2),
        },
        {
          type: 'subscription.canceled',
          id: 'evt_end',
          providerId: 'com.app.pro',
          holdingId: 'sub_old',
          occurredAt: at(2),
        },
      ]),
    })

    await expect(mixed).rejects.toMatchObject({ reason: 'other-user' })
    expect(await store.getAccount('u2')).toBeNull()
    // Not even a link: the new subscription is not kept from whoever it belongs to.
    expect(await store.findUserId('holding', 'app:sub_new')).toBeNull()
    expect((await billing.account('u1')).holdings[0]).toMatchObject({ status: 'active' })
  })

  it('gives a proof two users hand over in the same instant to one of them', async () => {
    const { billing, unlock } = await setup()
    const users = ['u1', 'u2', 'u3', 'u4']

    const results = await Promise.allSettled(
      users.map((userId) => billing.verifyPurchase({ provider: 'app', userId, proof: unlock() })),
    )

    const won = results.filter((result) => result.status === 'fulfilled')
    const lost = results.filter((result) => result.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost.map((result) => (result.reason as BillingPurchaseError).reason)).toEqual([
      'other-user',
      'other-user',
      'other-user',
    ])
    const holders = await Promise.all(users.map((userId) => billing.account(userId)))
    expect(holders.filter((account) => account.holdings.length > 0)).toHaveLength(1)
  })

  it('refuses a proof that does not verify and changes nothing', async () => {
    const { billing, app, store } = await setup()

    // One after the other: a second refusal that waits for the first has nobody listening yet.
    const forged = billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: app.invalidProof(),
    })
    await expect(forged).rejects.toMatchObject({ name: 'BillingPurchaseError', reason: 'invalid' })

    const made = billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      // What a client could make up: it says it bought, and nothing verifies it.
      proof: { product: 'unlock', paid: true },
    })
    await expect(made).rejects.toMatchObject({ reason: 'invalid' })
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('skips a purchase of something the config does not sell there', async () => {
    const { billing, store, unlock } = await setup()

    const { events, skipped } = await billing.verifyPurchase({
      provider: 'app',
      userId: 'u1',
      proof: unlock({ providerId: 'com.app.other' }),
    })

    expect(events).toEqual([])
    expect(skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect(await store.getAccount('u1')).toBeNull()
    // The purchase was linked to nobody: it is not kept from its user later.
    expect(await store.findUserId('holding', 'app:txn_1')).toBeNull()
  })

  it('refuses a provider whose purchases start on the server, and an empty user id', async () => {
    const { store, unlock } = await setup()
    const serverSide: BillingDriver = {
      name: 'server',
      createCheckout: async () => ({ id: 'chk_1', url: null }),
      parseWebhook: async () => ({ events: [] }),
      createManageUrl: async () => null,
    }
    const billing = createBilling({
      drivers: { web: serverSide, app: createFakeBillingDriver() },
      store,
      products,
    })

    const noProofs = billing.verifyPurchase({ provider: 'web', userId: 'u1', proof: unlock() })
    await expect(noProofs).rejects.toThrow(/takes no purchase from a device/)
    await expect(noProofs).rejects.not.toBeInstanceOf(BillingPurchaseError)
    await expect(
      billing.verifyPurchase({ provider: 'app', userId: '', proof: unlock() }),
    ).rejects.toThrow(/userId must be a non-empty string/)
    await expect(billing.verifyPurchase({ userId: 'u1', proof: unlock() })).rejects.toThrow(
      /several drivers/,
    )
  })
})

describe('telling the provider that a purchase was delivered', () => {
  function setup() {
    const fake = createFakeBillingDriver()
    const store = createMemoryBillingStore()
    const onError = vi.fn()
    /** What the account held each time the driver was told */
    const settled: number[] = []
    let failing = false
    const settle = async (): Promise<void> => {
      settled.push((await store.getAccount('u1'))?.holdings.length ?? 0)
      if (failing) throw new Error('the provider is down')
    }
    const driver: BillingDriver = {
      ...fake,
      async parseWebhook(request) {
        return { ...(await fake.parseWebhook(request)), settle }
      },
      async verifyPurchase(input) {
        return { ...(await fake.verifyPurchase(input)), settle }
      },
    }
    const billing = createBilling({
      driver,
      store,
      products: { unlock: { type: 'one-time', providerId: 'sku_unlock' } },
      onError,
    })
    const purchase = {
      type: 'purchase.completed',
      id: 'evt_1',
      providerId: 'sku_unlock',
      holdingId: 'tok_1',
      occurredAt: at(0),
    } as const
    return {
      billing,
      fake,
      store,
      onError,
      settled,
      purchase,
      fail: (value: boolean) => (failing = value),
    }
  }

  it('settles a webhook once its events are in the account, and again for a redelivery', async () => {
    const { billing, fake, settled, purchase } = setup()
    const webhook = () => fake.webhook({ ...purchase, userId: 'u1' })

    const first = await billing.handleWebhook(webhook())
    expect(first.response.status).toBe(200)
    // The purchase was stored before the provider was told.
    expect(settled).toEqual([1])

    const again = await billing.handleWebhook(webhook())
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(settled).toEqual([1, 1])
  })

  it('does not settle while an event waits for its user, or names an unknown product', async () => {
    const { billing, fake, settled, purchase } = setup()

    const waiting = await billing.handleWebhook(fake.webhook(purchase))
    const unknown = await billing.handleWebhook(
      fake.webhook({ ...purchase, userId: 'u1', providerId: 'sku_other' }),
    )
    const refused = await billing.handleWebhook(fake.invalidWebhook())

    expect(waiting.response.status).toBe(409)
    expect(unknown.response.status).toBe(200)
    expect(refused.response.status).toBe(401)
    expect(settled).toEqual([])
  })

  it('answers 500 when settling fails, and settles on the redelivery', async () => {
    const { billing, fake, settled, purchase, onError, fail } = setup()
    const webhook = () => fake.webhook({ ...purchase, userId: 'u1' })

    fail(true)
    const failed = await billing.handleWebhook(webhook())
    expect(failed.response.status).toBe(500)
    expect(failed.events).toHaveLength(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect((await billing.account('u1')).holdings).toHaveLength(1)

    fail(false)
    const retried = await billing.handleWebhook(webhook())
    expect(retried.response.status).toBe(200)
    expect(retried.events).toEqual([])
    expect(settled).toEqual([1, 1])
  })

  it('settles a proof after it was applied, and again when it is handed over again', async () => {
    const { billing, fake, settled, purchase, fail } = setup()
    const proof = fake.proof(purchase)

    fail(true)
    await expect(billing.verifyPurchase({ userId: 'u1', proof })).rejects.toThrow(
      'the provider is down',
    )
    // Stored all the same: the purchase is the user's, and the next try settles it.
    expect((await billing.account('u1')).holdings).toHaveLength(1)

    fail(false)
    const retried = await billing.verifyPurchase({ userId: 'u1', proof })
    expect(retried.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(settled).toEqual([1, 1])
  })

  it('does not settle a proof that is refused', async () => {
    const { billing, fake, settled, purchase } = setup()
    await billing.verifyPurchase({ userId: 'u2', proof: fake.proof(purchase) })
    settled.length = 0

    await expect(
      billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) }),
    ).rejects.toMatchObject({ reason: 'other-user' })
    await expect(
      billing.verifyPurchase({ userId: 'u1', proof: fake.invalidProof() }),
    ).rejects.toMatchObject({ reason: 'invalid' })
    // Nor one for something the config does not sell: it was not delivered.
    const unknown = await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...purchase, id: 'evt_2', holdingId: 'tok_2', providerId: 'sku_other' }),
    })
    expect(unknown.skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect(settled).toEqual([])
  })
})

describe('a driver that asks its provider about a proof that may be out of date', () => {
  const purchase = {
    type: 'purchase.completed',
    id: 'evt_1',
    providerId: 'sku_unlock',
    holdingId: 'tok_1',
    occurredAt: at(0),
  } as const
  const refund = {
    type: 'payment.refunded',
    id: 'evt_1:refund',
    providerId: 'sku_unlock',
    holdingId: 'tok_1',
    occurredAt: at(5),
  } as const

  /** A driver whose every proof may be out of date; `answer` is what the provider says today */
  function setup(answer: (told: ProviderEvent[]) => ProviderEvent[] | Promise<ProviderEvent[]>) {
    const fake = createFakeBillingDriver()
    const store = createMemoryBillingStore()
    const asked: ProviderEvent[][] = []
    const driver: BillingDriver = {
      ...fake,
      async verifyPurchase(input) {
        const verified = await fake.verifyPurchase(input)
        return {
          ...verified,
          async refresh() {
            asked.push(verified.events)
            return answer(verified.events)
          },
        }
      },
    }
    const billing = createBilling({
      driver,
      store,
      products: {
        unlock: { type: 'one-time', providerId: 'sku_unlock', features: ['themes'] },
        pro: { type: 'subscription', providerId: 'sku_pro', features: ['export'] },
      },
    })
    return { billing, fake, store, asked }
  }

  it('applies what the provider answers in place of what the proof says', async () => {
    const { billing, fake, asked } = setup((told) => [...told, { ...refund }])
    const { events } = await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })

    expect(asked).toHaveLength(1)
    expect(events.map((event) => event.type)).toEqual(['purchase.completed', 'payment.refunded'])
    expect((await billing.account('u1')).holdings).toMatchObject([{ status: 'refunded' }])
    expect((await billing.entitlements('u1')).has('themes')).toBe(false)
  })

  it('applies nothing when the provider answers nothing', async () => {
    const { billing, fake, store } = setup(() => [])
    const result = await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })

    expect(result).toEqual({ events: [], skipped: [] })
    expect(await store.getAccount('u1')).toBeNull()
    // Nothing of the proof was linked: its purchase is still nobody's.
    expect(await store.findUserId('holding', 'fake:tok_1')).toBeNull()
  })

  it('does not ask about a proof the account has, or one that is older than the account', async () => {
    const { billing, fake, asked } = setup((told) => told)
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })
    expect(asked).toHaveLength(1)

    const again = await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    // Told before the purchase the account knows: it could not change it.
    const older = await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...purchase, id: 'evt_0', occurredAt: at(-5) }),
    })
    expect(older.skipped.map((entry) => entry.reason)).toEqual(['stale'])
    expect(asked).toHaveLength(1)
  })

  it('does not ask about a proof that says nothing the config sells', async () => {
    const { billing, fake, asked } = setup((told) => told)
    const unknown = await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...purchase, providerId: 'sku_other' }),
    })
    // A refund that names only its purchase, which is not in the account.
    const waiting = await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...refund, providerId: undefined }),
    })

    expect(unknown.skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect(waiting.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])
    expect(asked).toEqual([])
  })

  it('asks about a proof that tells an event the account does not have', async () => {
    const { billing, fake, asked } = setup((told) => told)
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })
    // The same purchase, told once more under another id: it leaves the holding as it is.
    const same = await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...purchase, id: 'evt_2', occurredAt: at(1) }),
    })
    expect(same.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(refund) })

    expect(asked.map((told) => told.map((event) => event.id))).toEqual([
      ['evt_1'],
      ['evt_2'],
      ['evt_1:refund'],
    ])
  })

  it('changes nothing when the provider cannot be asked', async () => {
    let down = true
    const { billing, fake, store } = setup((told) => {
      if (down) throw new Error('the provider is down')
      return told
    })
    await expect(
      billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) }),
    ).rejects.toThrow('the provider is down')
    expect(await store.getAccount('u1')).toBeNull()
    expect(await store.findUserId('holding', 'fake:tok_1')).toBeNull()

    down = false
    const { events } = await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })
    expect(events).toMatchObject([{ type: 'purchase.completed', userId: 'u1' }])
  })

  it('checks whose purchase it is on what the provider answers', async () => {
    const { billing, fake, store } = setup((told) =>
      told.map((event) => ({ ...event, userId: 'u2' })),
    )
    const refused = billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })

    await expect(refused).rejects.toBeInstanceOf(BillingPurchaseError)
    await expect(refused).rejects.toMatchObject({ reason: 'other-user' })
    expect(await store.getAccount('u1')).toBeNull()
  })

  it('settles as before, on what was applied', async () => {
    const fake = createFakeBillingDriver()
    const settle = vi.fn(async () => {})
    const billing = createBilling({
      driver: {
        ...fake,
        async verifyPurchase(input) {
          const verified = await fake.verifyPurchase(input)
          return { ...verified, settle, refresh: async () => verified.events }
        },
      },
      store: createMemoryBillingStore(),
      products: { unlock: { type: 'one-time', providerId: 'sku_unlock' } },
    })
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(purchase) })
    expect(settle).toHaveBeenCalledTimes(1)
  })
})

describe('a provider that books a change of plan as a new purchase', () => {
  const plans = {
    pro: { type: 'subscription', providerId: 'sku_pro', features: ['export'] },
    team: { type: 'subscription', providerId: 'sku_team', features: ['export', 'seats'] },
  } as const

  function setup(options: { acceptUnmatched?: boolean } = {}) {
    const fake = createFakeBillingDriver()
    const settled: string[] = []
    const driver: BillingDriver = {
      ...fake,
      async parseWebhook(request) {
        return {
          ...(await fake.parseWebhook(request)),
          settle: async () => void settled.push('settled'),
          ...(options.acceptUnmatched ? { acceptUnmatched: true } : {}),
        }
      },
    }
    const billing = createBilling({
      driver,
      store: createMemoryBillingStore(),
      products: plans,
      onError: (error) => {
        throw error
      },
    })
    const started = {
      type: 'subscription.started',
      id: 'evt_1',
      providerId: 'sku_pro',
      holdingId: 'tok_1',
      occurredAt: at(0),
      currentPeriodEnd: at(30),
    } as const
    const changed = {
      type: 'subscription.changed',
      id: 'evt_2',
      providerId: 'sku_team',
      holdingId: 'tok_2',
      replacesHoldingId: 'tok_1',
      occurredAt: at(10),
      currentPeriodEnd: at(40),
    } as const
    return { billing, fake, settled, started, changed }
  }

  it('finds the user through the purchase that was replaced, and ends that purchase', async () => {
    const { billing, fake, started, changed } = setup()
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(started) })

    // The webhook names no user: the new purchase is the one of the old purchase's user.
    const result = await billing.handleWebhook(fake.webhook(changed))

    expect(result.response.status).toBe(200)
    expect(result.events).toMatchObject([
      {
        type: 'subscription.changed',
        userId: 'u1',
        holdingId: 'tok_2',
        replacesHoldingId: 'tok_1',
      },
    ])
    expect((await billing.account('u1')).holdings).toMatchObject([
      { id: 'tok_1', product: 'pro', status: 'canceled', accessEndsAt: at(10), updatedAt: at(10) },
      { id: 'tok_2', product: 'team', status: 'active', accessEndsAt: null },
    ])
    expect((await billing.entitlements('u1', { now: at(11) })).products).toEqual(['team'])

    // Later events of the new purchase find their user by themselves and end nothing again.
    const renewed = await billing.handleWebhook(
      fake.webhook({
        ...changed,
        type: 'subscription.renewed',
        id: 'evt_3',
        occurredAt: at(20),
        currentPeriodEnd: at(50),
      }),
    )
    expect(renewed.events).toHaveLength(1)
    expect((await billing.account('u1')).holdings[0]).toMatchObject({ accessEndsAt: at(10) })
  })

  it('counts an event as applied when all it changes is the purchase it replaces', async () => {
    const { billing, fake, started, changed } = setup()
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(started) })
    // The new purchase is known already, from an event that did not say what it replaces.
    await billing.verifyPurchase({
      userId: 'u1',
      proof: fake.proof({ ...changed, id: 'evt_0', replacesHoldingId: undefined }),
    })
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')

    const result = await billing.handleWebhook(fake.webhook(changed))

    expect(result.events).toHaveLength(1)
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: at(10),
    })
  })

  it('leaves a replaced purchase that is over, refunded or newer than the event', async () => {
    const { billing, fake, started, changed } = setup()
    const previous = (holdingId: string, last: FakeBillingEvent) =>
      billing.verifyPurchase({
        userId: 'u1',
        proof: fake.proof([{ ...started, id: `${holdingId}_start`, holdingId }, last]),
      })
    await previous('over', {
      type: 'subscription.canceled',
      id: 'over_end',
      providerId: 'sku_pro',
      holdingId: 'over',
      occurredAt: at(1),
      accessEndsAt: at(5),
    })
    await previous('refunded', {
      type: 'payment.refunded',
      id: 'refunded_end',
      providerId: 'sku_pro',
      holdingId: 'refunded',
      occurredAt: at(2),
    })
    await previous('newer', {
      type: 'subscription.renewed',
      id: 'newer_renewal',
      providerId: 'sku_pro',
      holdingId: 'newer',
      occurredAt: at(15),
      currentPeriodEnd: at(45),
    })

    for (const replacesHoldingId of ['over', 'refunded', 'newer', 'unknown', 'tok_2']) {
      await billing.handleWebhook(
        fake.webhook({
          ...changed,
          id: `evt_${replacesHoldingId}`,
          userId: 'u1',
          replacesHoldingId,
        }),
      )
    }

    expect((await billing.account('u1')).holdings).toMatchObject([
      { id: 'over', status: 'canceled', accessEndsAt: at(5) },
      { id: 'refunded', status: 'refunded', accessEndsAt: at(2) },
      { id: 'newer', status: 'active', accessEndsAt: null },
      { id: 'tok_2', status: 'active' },
    ])
  })

  it('refuses a proof whose purchase replaces the purchase of another user', async () => {
    const { billing, fake, started, changed } = setup()
    await billing.verifyPurchase({ userId: 'u1', proof: fake.proof(started) })

    const refused = await billing
      .verifyPurchase({ userId: 'u2', proof: fake.proof(changed) })
      .catch((error) => error)

    expect(refused).toBeInstanceOf(BillingPurchaseError)
    expect(refused.reason).toBe('other-user')
    expect((await billing.account('u2')).holdings).toEqual([])
    expect((await billing.account('u1')).holdings).toMatchObject([
      { id: 'tok_1', status: 'active' },
    ])
  })

  it('answers an event without a user with 409, unless the driver says a second delivery brings nothing', async () => {
    const retried = setup()
    const waiting = await retried.billing.handleWebhook(retried.fake.webhook(retried.started))
    expect(waiting.response.status).toBe(409)
    expect(retried.settled).toEqual([])

    const accepted = setup({ acceptUnmatched: true })
    const left = await accepted.billing.handleWebhook(accepted.fake.webhook(accepted.started))
    expect(left.response.status).toBe(200)
    expect(left.events).toEqual([])
    expect(left.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])
    // Left, not delivered: the provider is not told that the purchase arrived.
    expect(accepted.settled).toEqual([])

    await accepted.billing.verifyPurchase({
      userId: 'u1',
      proof: accepted.fake.proof(accepted.started),
    })
    const known = await accepted.billing.handleWebhook(accepted.fake.webhook(accepted.started))
    expect(known.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(accepted.settled).toEqual(['settled'])
  })
})

describe('the drivers of a config', () => {
  const base = {
    store: createMemoryBillingStore(),
    products: { pro: { type: 'subscription', providerId: 'pri_pro' } },
  } as const

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the one driver after itself, and needs no provider on a call', async () => {
    const driver = createFakeBillingDriver()
    const billing = createBilling({ ...base, driver })

    await billing.handleWebhook(
      driver.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
    )
    await billing.checkout({ provider: 'fake', userId: 'u1', product: 'pro' })

    expect((await billing.account('u1')).holdings[0]?.provider).toBe('fake')
    expect(driver.checkouts).toHaveLength(1)
    await expect(
      billing.checkout({ provider: 'paddle', userId: 'u1', product: 'pro' }),
    ).rejects.toThrow(/unknown provider "paddle"/)
  })

  it('takes a built-in driver by its name under any provider name', async () => {
    const billing = createBilling({
      drivers: { dev: 'console', app: createFakeBillingDriver() },
      console: { webhookUrl: '/hook' },
      store: createMemoryBillingStore(),
      products: { pro: { type: 'subscription', providerId: { dev: 'pri_pro', app: 'app.pro' } } },
    })

    const checkout = await billing.checkout({ provider: 'dev', userId: 'u1', product: 'pro' })
    await billing.handleWebhook(new Request(new URL(checkout.url!, 'https://app.example')), {
      provider: 'dev',
    })

    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      provider: 'dev',
      product: 'pro',
    })
  })

  it('refuses a config with both `driver` and `drivers`, with neither, and with none in `drivers`', () => {
    const driver = createFakeBillingDriver()
    expect(() => createBilling({ ...base, driver, drivers: { web: driver } })).toThrow(
      /has `driver` and `drivers`/,
    )
    expect(() => createBilling({ ...base })).toThrow(/needs a `driver`, or `drivers`/)
    expect(() => createBilling({ ...base, drivers: {} })).toThrow(/`drivers` is empty/)
    expect(() => createBilling({ ...base, drivers: { web: 'paddle' } })).toThrow(
      /needs the `paddle` options/,
    )
  })

  it('refuses a provider name that could not stand in front of an id', () => {
    const driver = createFakeBillingDriver()
    for (const name of ['Apple', 'a:b', '1st', '', 'app store']) {
      expect(() =>
        createBilling({
          drivers: { [name]: driver },
          store: createMemoryBillingStore(),
          products: {},
        }),
      ).toThrow(/cannot name a provider/)
    }
    expect(() => createBilling({ ...base, driver: { ...driver, name: 'My Provider' } })).toThrow(
      /"My Provider" cannot name a provider/,
    )
  })

  it('refuses product ids that could not be matched', () => {
    const drivers = { web: createFakeBillingDriver(), app: createFakeBillingDriver() }
    const config = (products: Parameters<typeof createBilling>[0]['products']) => () =>
      createBilling({ drivers, store: createMemoryBillingStore(), products })

    expect(config({ pro: { type: 'subscription', providerId: 'pri_pro' } })).toThrow(
      /has one providerId, and the config has several drivers\. Write it by provider: \{ web, app \}/,
    )
    expect(config({ pro: { type: 'subscription', providerId: { shop: 'pri_pro' } } })).toThrow(
      /has a providerId for "shop", which is not a driver of the config \(web, app\)/,
    )
    expect(config({ pro: { type: 'subscription', providerId: { web: '' } } })).toThrow(
      /providerId of product "pro" is empty/,
    )
    expect(
      config({
        a: { type: 'one-time', providerId: { web: 'id_1', app: 'id_a' } },
        b: { type: 'one-time', providerId: { web: 'id_2', app: 'id_a' } },
      }),
    ).toThrow(/products "a" and "b" share the providerId "id_a" at "app"/)
    // The same id at two providers is two ids.
    expect(
      config({
        a: { type: 'one-time', providerId: { web: 'id_1', app: 'id_2' } },
        b: { type: 'one-time', providerId: { web: 'id_2', app: 'id_1' } },
      }),
    ).not.toThrow()
    // @ts-expect-error a product without a providerId
    expect(config({ pro: { type: 'subscription' } })).toThrow(/has no providerId/)
  })
})
