import { afterEach, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import { readFileSync } from 'node:fs'
import { MemoryAdapter } from '@loewen-digital/flatdb'
import {
  BillingError,
  BillingPurchaseError,
  createBilling,
  createGooglePlayDriver,
  createMemoryBillingStore,
} from '../index.js'
import type { BillingStore, GooglePlayDriverConfig } from '../index.js'
import { createFlatdbBillingStore } from '../stores/flatdb.js'
import { FAKE_KEY_ID, createFakeGoogle, signJwt } from './google-play-fake.js'
import type { PushOptions } from './google-play-fake.js'

// Purchases and notifications in the shape of Google's reference, see
// fixtures/google-play/README.md. A fake stands in for Google: it answers the API from what a
// test puts into it, and signs push requests with a key it makes for the run.
type Fields = Record<string, unknown>

function fixture(name: string): Fields {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/google-play/${name}.json`, import.meta.url), 'utf8'),
  ) as Fields
}

const PACKAGE = 'com.example.app'
const AUDIENCE = 'https://example.com/billing/webhook/play'
const PROVIDER = 'google-play'
/** The purchase tokens of the fixtures, and the holdings they stand for: their SHA-256 */
const SUBSCRIPTION = 'fixture-subscription.AO-J1Oz-made-up-purchase-token-0001'
const SUBSCRIPTION_HOLDING = '85fa391ab7133d6f7d8323e8e632fd1602a9e2aea901025f718783355a54ac96'
const ONE_TIME = 'fixture-one-time.AO-J1Oz-made-up-purchase-token-0002'
const ONE_TIME_HOLDING = '5c2ed1cfbdbd8d69105637dac522beb165c4f87ffdf37911777adb20383e6c4d'
const ORDER = 'GPA.3345-0000-0000-00001'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const BOUGHT = Date.UTC(2026, 10, 10, 10) // when the fixtures were bought
const UNTIL = Date.UTC(2026, 11, 10, 10) // what the subscription of the fixtures is paid until
const NOW = BOUGHT + MINUTE
const ACKNOWLEDGED = { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }

// Only the clock: Web Crypto and the stores keep their real timers.
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

const products = {
  pro: { type: 'subscription', providerId: 'pro', features: ['export'] },
  team: { type: 'subscription', providerId: 'team', features: ['export', 'seats'] },
  unlock: { type: 'one-time', providerId: 'unlock', features: ['themes'] },
  credits: { type: 'one-time', providerId: 'credits' },
} as const

async function shop(
  options: { store?: BillingStore; driver?: Partial<GooglePlayDriverConfig> } = {},
) {
  const google = await createFakeGoogle()
  const errors: unknown[] = []
  const billing = createBilling({
    driver: createGooglePlayDriver({
      packageName: PACKAGE,
      clientEmail: google.clientEmail,
      privateKey: google.privateKey,
      pushAudience: AUDIENCE,
      consumables: ['credits'],
      fetch: google.fetch,
      ...options.driver,
    }),
    store: options.store ?? createMemoryBillingStore(),
    products,
    onError: (error) => errors.push(error),
  })
  /** Hands a notification over as Cloud Pub/Sub pushes it */
  const deliver = async (notification: unknown, push?: PushOptions) =>
    billing.handleWebhook(await google.push(notification, push))
  /** The requests that reached Google and whose URL contains `part` */
  const asked = (part: string) => google.calls.filter((call) => call.url.includes(part))
  return { google, billing, errors, deliver, asked }
}

/** The subscription of the fixtures as Google holds it; `item` changes its one line item */
function subscription(changes: Fields = {}, item: Fields = {}): Fields {
  const base = fixture('subscription-purchased')
  return { ...base, ...changes, lineItems: [{ ...(base.lineItems as Fields[])[0], ...item }] }
}

/** The one-time purchase of the fixtures; `details` changes the offer details of its item */
function purchase(changes: Fields = {}, productId = 'unlock', details: Fields = {}): Fields {
  const base = fixture('product-purchased')
  const item = (base.productLineItem as Fields[])[0]!
  return {
    ...base,
    ...changes,
    productLineItem: [
      {
        ...item,
        productId,
        productOfferDetails: { ...(item.productOfferDetails as Fields), ...details },
      },
    ],
  }
}

/** A notification about a subscription: the one of the fixtures, with another type and token */
function about(type: number, token = SUBSCRIPTION, at = Date.now()): Fields {
  return {
    ...fixture('notification-subscription-purchased'),
    eventTimeMillis: String(at),
    subscriptionNotification: { version: '1.0', notificationType: type, purchaseToken: token },
  }
}

const iso = (time: number): string => new Date(time).toISOString()

/** A subscription of user `u1` that billing already holds: handed over and acknowledged */
async function subscribed() {
  const context = await shop()
  context.google.subscriptions.set(SUBSCRIPTION, subscription())
  await context.billing.verifyPurchase({
    userId: 'u1',
    proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
  })
  context.google.calls.length = 0
  return context
}

describe('the Google Play driver', () => {
  const config: GooglePlayDriverConfig = {
    packageName: PACKAGE,
    clientEmail: 'billing@example-project.iam.gserviceaccount.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
    pushAudience: AUDIENCE,
  }

  it('is made from the package, the service account and the audience of the pushes', () => {
    expect(createGooglePlayDriver(config).name).toBe('google-play')
  })

  it.each<[string, Partial<Record<keyof GooglePlayDriverConfig, unknown>>, RegExp]>([
    ['no package name', { packageName: '' }, /`packageName`/],
    ['a package name that is none', { packageName: 'example' }, /`packageName`/],
    ['no service account', { clientEmail: 'billing' }, /`clientEmail`/],
    ['a key that is no key file entry', { privateKey: 'AAAA' }, /`privateKey`/],
    ['no key', { privateKey: undefined }, /`privateKey`/],
    ['no audience', { pushAudience: '' }, /`pushAudience`/],
    ['a push account that is no address', { pushServiceAccount: 'pubsub' }, /`pushServiceAccount`/],
    ['consumables that are no ids', { consumables: ['credits', ''] }, /`consumables`/],
  ])('refuses a config with %s', (_name, changes, message) => {
    expect(() =>
      createGooglePlayDriver({ ...config, ...changes } as GooglePlayDriverConfig),
    ).toThrow(BillingError)
    expect(() =>
      createGooglePlayDriver({ ...config, ...changes } as GooglePlayDriverConfig),
    ).toThrow(message)
  })

  it('starts no checkout: a purchase starts on the device', async () => {
    const { billing } = await shop()
    await expect(billing.checkout({ userId: 'u1', product: 'pro' })).rejects.toThrow(
      /starts on the device/,
    )
  })
})

describe('the service account of the driver', () => {
  const proof = { itemId: 'pro', purchaseToken: SUBSCRIPTION }

  it('asks Google for an access token with an assertion it signed', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    await billing.verifyPurchase({ userId: 'u1', proof })

    // The fake only takes an assertion that the key of the service account signed.
    expect(google.calls[0]).toEqual({ method: 'POST', url: 'https://oauth2.googleapis.com/token' })
    expect(google.assertions).toEqual([
      {
        header: { alg: 'RS256', typ: 'JWT' },
        iss: google.clientEmail,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: NOW / 1000,
        exp: NOW / 1000 + 3600,
      },
    ])
  })

  it('uses one token for every call, and asks again before it ends', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    await billing.verifyPurchase({ userId: 'u1', proof })
    vi.setSystemTime(NOW + 54 * MINUTE)
    await billing.verifyPurchase({ userId: 'u1', proof })
    expect(google.assertions).toHaveLength(1)

    vi.setSystemTime(NOW + 56 * MINUTE)
    await billing.verifyPurchase({ userId: 'u1', proof })
    expect(google.assertions).toHaveLength(2)
  })

  it('asks once for two purchases that arrive in the same instant', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    google.products.set(ONE_TIME, purchase())

    await Promise.all([
      billing.verifyPurchase({ userId: 'u1', proof }),
      billing.verifyPurchase({
        userId: 'u1',
        proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
      }),
    ])

    expect(google.assertions).toHaveLength(1)
  })

  it('takes a key whose line breaks arrive as the two characters \\n', async () => {
    const google = await createFakeGoogle()
    const { billing } = await shop({
      driver: { privateKey: google.privateKey.replace(/\n/g, '\\n') },
    })

    // The token service of the fake of `shop` took the assertion: the key was read.
    await expect(billing.verifyPurchase({ userId: 'u1', proof })).rejects.toThrow(
      /knows no subscription/,
    )
  })

  it('says what Google answered when it gives no token, and asks again the next time', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    google.failNext('oauth2.googleapis.com/token', 400, {
      error: 'invalid_grant',
      error_description: 'Invalid grant: account not found',
    })

    const refused = await billing.verifyPurchase({ userId: 'u1', proof }).catch((error) => error)

    expect(refused).toBeInstanceOf(BillingError)
    expect(refused).not.toBeInstanceOf(BillingPurchaseError)
    expect(refused.message).toMatch(/no access token \(400 invalid_grant: Invalid grant: account/)
    expect(refused.message).not.toMatch(/PRIVATE KEY|eyJ/)
    await expect(billing.verifyPurchase({ userId: 'u1', proof })).resolves.toMatchObject({
      events: [{ type: 'subscription.started' }],
    })
  })

  it('says so when the key is not an RSA key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    const { google, billing } = await shop({
      driver: {
        privateKey: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`,
      },
    })

    await expect(billing.verifyPurchase({ userId: 'u1', proof })).rejects.toThrow(
      /`privateKey` of the Google Play driver is not an RSA key/,
    )
    expect(google.calls).toEqual([])
  })

  it('forgets a token Google no longer takes', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    google.failNext('subscriptionsv2', 401, {
      error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' },
    })

    await expect(billing.verifyPurchase({ userId: 'u1', proof })).rejects.toThrow(
      /answered 401 for purchases\.subscriptionsv2\.get \(UNAUTHENTICATED: Invalid Credentials\)/,
    )
    await billing.verifyPurchase({ userId: 'u1', proof })

    expect(google.assertions).toHaveLength(2)
  })
})

describe('a purchase of Google Play the app hands over', () => {
  it('starts a subscription from what Google says, and acknowledges it', async () => {
    const { google, billing, asked } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(result).toEqual({
      events: [
        {
          type: 'subscription.started',
          id: `${SUBSCRIPTION_HOLDING}:paid:${ORDER}`,
          provider: PROVIDER,
          userId: 'u1',
          product: 'pro',
          holdingId: SUBSCRIPTION_HOLDING,
          occurredAt: new Date(NOW),
          currentPeriodEnd: new Date(UNTIL),
        },
      ],
      skipped: [],
    })
    const account = await billing.account('u1')
    expect(account.holdings).toEqual([
      {
        provider: PROVIDER,
        id: SUBSCRIPTION_HOLDING,
        product: 'pro',
        type: 'subscription',
        status: 'active',
        startedAt: new Date(NOW),
        currentPeriodEnd: new Date(UNTIL),
        accessEndsAt: null,
        pastDueSince: null,
        updatedAt: new Date(NOW),
      },
    ])
    expect(asked(':acknowledge')).toEqual([
      {
        method: 'POST',
        url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/subscriptions/pro/tokens/${SUBSCRIPTION}:acknowledge`,
        body: '{}',
      },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
    // The token stays with Google and the device: billing keeps its hash.
    expect(JSON.stringify(account)).not.toContain(SUBSCRIPTION)
  })

  it('takes the same purchase twice as one, and acknowledges once', async () => {
    const { google, billing, asked } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    const proof = { itemId: 'pro', purchaseToken: SUBSCRIPTION }

    await billing.verifyPurchase({ userId: 'u1', proof })
    const again = await billing.verifyPurchase({ userId: 'u1', proof })

    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(asked(':acknowledge')).toHaveLength(1)
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('gives a purchase to the user who hands it over first, and to nobody else', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    const proof = { itemId: 'pro', purchaseToken: SUBSCRIPTION }
    await billing.verifyPurchase({ userId: 'u1', proof })

    const refused = await billing.verifyPurchase({ userId: 'u2', proof }).catch((error) => error)

    expect(refused).toBeInstanceOf(BillingPurchaseError)
    expect(refused.reason).toBe('other-user')
    expect((await billing.account('u2')).holdings).toEqual([])
  })

  it.each<[string, unknown]>([
    ['a token alone', SUBSCRIPTION],
    ['nothing', undefined],
    ['an empty object', {}],
    ['no item', { purchaseToken: SUBSCRIPTION }],
    ['no token', { itemId: 'pro' }],
    ['an empty token', { itemId: 'pro', purchaseToken: '' }],
    ['a token with a line break', { itemId: 'pro', purchaseToken: 'abc\ndef' }],
    ['a token of 3000 characters', { itemId: 'pro', purchaseToken: 'a'.repeat(3000) }],
    ['an item the config does not sell', { itemId: 'gold', purchaseToken: SUBSCRIPTION }],
    ['an item of the object prototype', { itemId: 'toString', purchaseToken: SUBSCRIPTION }],
  ])('refuses %s as a proof without asking Google', async (_name, proof) => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    const refused = await billing.verifyPurchase({ userId: 'u1', proof }).catch((error) => error)

    expect(refused).toBeInstanceOf(BillingPurchaseError)
    expect(refused.reason).toBe('invalid')
    expect(google.calls).toEqual([])
  })

  it.each([400, 404, 410])(
    'refuses a token Google answers %i for, and keeps it out of the message',
    async (status) => {
      const { google, billing, asked } = await shop()
      google.subscriptions.set(SUBSCRIPTION, subscription())
      google.failNext('subscriptionsv2', status, {
        error: { code: status, message: `No purchase under ${SUBSCRIPTION}`, status: 'FAILED' },
      })

      const refused = await billing
        .verifyPurchase({ userId: 'u1', proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION } })
        .catch((error) => error)

      expect(refused).toBeInstanceOf(BillingPurchaseError)
      expect(refused.reason).toBe('invalid')
      expect(refused.message).toMatch(/knows no subscription of this app/)
      expect(refused.message).not.toContain(SUBSCRIPTION)
      expect(asked(':acknowledge')).toEqual([])
      expect((await billing.account('u1')).holdings).toEqual([])
    },
  )

  it('refuses a subscription that is handed over as a one-time purchase', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    const refused = await billing
      .verifyPurchase({ userId: 'u1', proof: { itemId: 'unlock', purchaseToken: SUBSCRIPTION } })
      .catch((error) => error)

    expect(refused).toBeInstanceOf(BillingPurchaseError)
    expect(refused.message).toMatch(/knows no one-time purchase of this app/)
  })

  it.each<[number, RegExp]>([
    [403, /answered 403 .*Give the service account access to the app in the Play Console/],
    [500, /answered 500 for purchases\.subscriptionsv2\.get/],
    [429, /answered 429/],
  ])('fails, and does not blame the proof, when Google answers %i', async (status, message) => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    google.failNext('subscriptionsv2', status, {
      error: { code: status, message: `Problem with ${SUBSCRIPTION}`, status: 'FAILED' },
    })

    const failed = await billing
      .verifyPurchase({ userId: 'u1', proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION } })
      .catch((error) => error)

    expect(failed).toBeInstanceOf(BillingError)
    expect(failed).not.toBeInstanceOf(BillingPurchaseError)
    expect(failed.message).toMatch(message)
    expect(failed.message).toContain('Problem with [purchase token]')
    expect(failed.message).not.toContain(SUBSCRIPTION)
  })

  it('says that Google was not reached, without the token', async () => {
    const { google, billing } = await shop({
      driver: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes('androidpublisher')) {
            throw new TypeError('fetch failed', {
              cause: new Error(`connect ECONNREFUSED ${String(input)}`),
            })
          }
          return google.fetch(input, init)
        }) as typeof fetch,
      },
    })

    const failed = await billing
      .verifyPurchase({ userId: 'u1', proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION } })
      .catch((error) => error)

    expect(failed).toBeInstanceOf(BillingError)
    expect(failed.message).toMatch(
      /Google Play was not reached for purchases\.subscriptionsv2\.get/,
    )
    expect(failed.message).not.toContain(SUBSCRIPTION)
  })

  it.each(['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'])(
    'refuses a subscription in %s: it is not paid',
    async (subscriptionState) => {
      const { google, billing, asked } = await shop()
      google.subscriptions.set(SUBSCRIPTION, subscription({ subscriptionState }))

      const refused = await billing
        .verifyPurchase({ userId: 'u1', proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION } })
        .catch((error) => error)

      expect(refused).toBeInstanceOf(BillingPurchaseError)
      expect(refused.message).toMatch(/is not paid/)
      expect(asked(':acknowledge')).toEqual([])
      expect((await billing.account('u1')).holdings).toEqual([])
    },
  )

  it('fails when Google does not take the acknowledgement, and makes up for it the next time', async () => {
    const { google, billing, asked } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())
    google.failNext(':acknowledge', 503)
    const proof = { itemId: 'pro', purchaseToken: SUBSCRIPTION }

    await expect(billing.verifyPurchase({ userId: 'u1', proof })).rejects.toThrow(
      /answered 503 for purchases\.subscriptions\.acknowledge/,
    )
    // What Google said is in the account; only Google does not know yet.
    expect((await billing.account('u1')).holdings).toHaveLength(1)
    expect(google.subscriptions.get(SUBSCRIPTION)).toMatchObject({
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    })

    const again = await billing.verifyPurchase({ userId: 'u1', proof })

    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(asked(':acknowledge')).toHaveLength(2)
    expect(google.subscriptions.get(SUBSCRIPTION)).toMatchObject(ACKNOWLEDGED)
  })

  it('takes the product from Google, not from what the app says it bought', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription({}, { productId: 'team' }))

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(result.events.map((event) => event.product)).toEqual(['team'])
  })

  it('leaves a product the config does not have, and does not acknowledge it', async () => {
    const { google, billing, asked } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription({}, { productId: 'gold' }))

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(result.events).toEqual([])
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect(asked(':acknowledge')).toEqual([])
  })

  it('says so when the config sells once what Google sold as a subscription', async () => {
    const { google, billing } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription({}, { productId: 'unlock' }))

    await expect(
      billing.verifyPurchase({
        userId: 'u1',
        proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
      }),
    ).rejects.toThrow(
      /product "unlock" is one-time in the config, and Google Play sold "unlock" as a subscription/,
    )
  })

  it('hands over a subscription that has ended as one that has ended', async () => {
    const { google, billing, asked } = await shop()
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription(
        { subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', ...ACKNOWLEDGED },
        { expiryTime: iso(BOUGHT - DAY) },
      ),
    )

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(result.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(BOUGHT - DAY) },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
    expect(asked(':acknowledge')).toEqual([])
  })

  it('completes a one-time purchase and acknowledges it, without using it up', async () => {
    const { google, billing, asked } = await shop()
    google.products.set(ONE_TIME, purchase())

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
    })

    expect(result.events).toEqual([
      {
        type: 'purchase.completed',
        id: `${ONE_TIME_HOLDING}:purchased`,
        provider: PROVIDER,
        userId: 'u1',
        product: 'unlock',
        holdingId: ONE_TIME_HOLDING,
        occurredAt: new Date(NOW),
      },
    ])
    expect(asked('/purchases/products/').map((call) => call.url.split(':').at(-1))).toEqual([
      'acknowledge',
    ])
    expect((await billing.entitlements('u1')).has('themes')).toBe(true)
  })

  it('consumes a consumable once it is applied, so it can be bought again', async () => {
    const { google, billing, asked } = await shop()
    const first = 'credits-purchase.AO-J1Oz-made-up-purchase-token-0003'
    const second = 'credits-purchase.AO-J1Oz-made-up-purchase-token-0004'
    google.products.set(first, purchase({}, 'credits'))
    google.products.set(second, purchase({ orderId: 'GPA.3345-0000-0000-00004' }, 'credits'))

    const one = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'credits', purchaseToken: first },
    })
    const two = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'credits', purchaseToken: second },
    })

    expect([...one.events, ...two.events].map((event) => event.type)).toEqual([
      'purchase.completed',
      'purchase.completed',
    ])
    expect(asked('/purchases/products/').map((call) => call.url.split(':').at(-1))).toEqual([
      'consume',
      'consume',
    ])
    expect((await billing.account('u1')).holdings).toHaveLength(2)
    // `consume` takes no body.
    expect(asked(':consume').every((call) => call.body === undefined)).toBe(true)

    // Handed over once more: applied before, and used up before.
    const again = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'credits', purchaseToken: first },
    })
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect(asked(':consume')).toHaveLength(2)
  })

  it('does not consume what was not applied', async () => {
    const { google, billing, asked } = await shop({ driver: { consumables: ['gems'] } })
    google.products.set(ONE_TIME, purchase({}, 'gems'))
    // The app thinks it bought credits, Google says gems, and the config has no gems.
    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'credits', purchaseToken: ONE_TIME },
    })

    expect(result.skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect(asked(':consume')).toEqual([])
  })

  it('refuses a one-time purchase that is not paid yet', async () => {
    const { google, billing, asked } = await shop()
    google.products.set(ONE_TIME, purchase({ purchaseStateContext: { purchaseState: 'PENDING' } }))

    await expect(
      billing.verifyPurchase({
        userId: 'u1',
        proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
      }),
    ).rejects.toThrow(/is not paid/)
    expect(asked(':acknowledge')).toEqual([])
  })

  it('keeps its ids in a flatdb store', async () => {
    const adapter = new MemoryAdapter()
    const { google, billing } = await shop({ store: createFlatdbBillingStore({ adapter }) })
    google.subscriptions.set(SUBSCRIPTION, subscription())

    await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(
      await adapter.read(`billing/refs/holding/google-play~3a${SUBSCRIPTION_HOLDING}.json`),
    ).toBe(JSON.stringify({ userId: 'u1' }))
  })
})

describe('real-time developer notifications', () => {
  const renewed = (changes: Fields = {}, item: Fields = {}) =>
    subscription(
      { ...ACKNOWLEDGED, ...changes },
      {
        latestSuccessfulOrderId: `${ORDER}..0`,
        expiryTime: iso(UNTIL + 30 * DAY),
        ...item,
      },
    )

  it.each<[string, PushOptions, number]>([
    ['is not a POST', { method: 'GET' }, 405],
    ['carries no token', { authorization: null }, 401],
    ['carries something else than a token', { authorization: 'Bearer abc' }, 401],
    ['carries a token another key signed', { stranger: true }, 401],
    ['names another audience', { claims: { aud: 'https://example.org/hook' } }, 401],
    ['names another service account', { claims: { email: 'x@evil.iam.gserviceaccount.com' } }, 401],
    ['names an address Google did not verify', { claims: { email_verified: false } }, 401],
    ['is issued by someone else', { claims: { iss: 'https://accounts.example.com' } }, 401],
    ['has expired', { claims: { exp: NOW / 1000 - 120 } }, 401],
    ['has no end', { claims: { exp: undefined } }, 401],
    ['is from the future', { claims: { iat: NOW / 1000 + 600 } }, 401],
    ['names a key Google does not publish', { header: { kid: 'made-up' } }, 401],
    ['names no key', { header: { kid: undefined } }, 401],
    ['is signed with another algorithm', { header: { alg: 'RS512' } }, 401],
    ['is not JSON', { body: 'hello' }, 400],
  ])('rejects a request that %s, and changes nothing', async (_name, push, status) => {
    const { google, deliver, asked, billing, errors } = await subscribed()
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', ...ACKNOWLEDGED }),
    )

    const result = await deliver(about(13), push)

    expect(result.response.status).toBe(status)
    expect(result.events).toEqual([])
    expect(asked('androidpublisher')).toEqual([])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
    expect(errors).toEqual([])
  })

  it('rejects a token without a signature, the "none" of JWTs', async () => {
    const { google, billing } = await subscribed()
    const request = await google.push(about(13))
    const [head, claims] = request.headers.get('Authorization')!.slice(7).split('.')
    const none = btoa(JSON.stringify({ alg: 'none', kid: FAKE_KEY_ID })).replace(/=+$/, '')

    for (const token of [
      `${none}.${claims}.`,
      `${none}.${claims}.AAAA`,
      `${head}.${claims}.AAAA`,
    ]) {
      const result = await billing.handleWebhook(
        await google.push(about(13), { authorization: `Bearer ${token}` }),
      )
      expect(result.response.status).toBe(401)
    }
  })

  it('rejects a token whose claims were changed after Google signed it', async () => {
    const { google, billing } = await subscribed()
    const stranger = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      },
      true,
      ['sign'],
    )
    const good = (await google.push(about(13))).headers.get('Authorization')!.slice(7).split('.')
    const forged = (
      await signJwt(stranger.privateKey, { alg: 'RS256', kid: FAKE_KEY_ID }, { aud: AUDIENCE })
    ).split('.')

    // Google's header and signature around other claims, and other claims with their own signature.
    for (const token of [
      `${good[0]}.${forged[1]}.${good[2]}`,
      `${good[0]}.${good[1]}.${forged[2]}`,
    ]) {
      const result = await billing.handleWebhook(
        await google.push(about(13), { authorization: `Bearer ${token}` }),
      )
      expect(result.response.status).toBe(401)
    }
  })

  it('takes the service account of the push subscription when it is another one', async () => {
    const { google, billing, deliver } = await shop({
      driver: { pushServiceAccount: 'pubsub-push@example-project.iam.gserviceaccount.com' },
    })

    expect((await deliver(fixture('notification-test'))).response.status).toBe(401)
    const result = await billing.handleWebhook(
      await google.push(fixture('notification-test'), {
        claims: { email: 'pubsub-push@example-project.iam.gserviceaccount.com' },
      }),
    )
    expect(result.response.status).toBe(200)
  })

  it('fetches the keys of Google once, and not for every key a request makes up', async () => {
    const { deliver, asked } = await shop()

    await deliver(fixture('notification-test'))
    await deliver(fixture('notification-test'))
    expect(asked('oauth2/v3/certs')).toHaveLength(1)

    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(NOW + 2 * MINUTE + attempt)
      const result = await deliver(fixture('notification-test'), { header: { kid: 'made-up' } })
      expect(result.response.status).toBe(401)
    }
    // Asked again once, a minute after the first time: Google may have new keys.
    expect(asked('oauth2/v3/certs')).toHaveLength(2)

    vi.setSystemTime(NOW + 62 * MINUTE)
    expect((await deliver(fixture('notification-test'))).response.status).toBe(200)
    expect(asked('oauth2/v3/certs')).toHaveLength(3)
  })

  it('answers with 500 while the keys of Google cannot be fetched, so the push comes again', async () => {
    const { google, deliver, errors } = await shop()
    google.failNext('oauth2/v3/certs', 503)

    const failed = await deliver(fixture('notification-test'))
    expect(failed.response.status).toBe(500)
    expect(String(errors[0])).toMatch(/signing keys could not be read \(503\)/)

    expect((await deliver(fixture('notification-test'))).response.status).toBe(200)
  })

  it.each<[string, unknown]>([
    ['a test from the Play Console', fixture('notification-test')],
    ['a notification for another app', { ...about(13), packageName: 'com.example.other' }],
    [
      'a refund that waits for review',
      {
        version: '1.0',
        packageName: PACKAGE,
        eventTimeMillis: String(NOW),
        pendingRefundReviewNotification: { version: '1.0', orderId: ORDER, refundReason: 7 },
      },
    ],
    ['a message that is no notification', 'hello'],
    [
      'a notification without a token',
      { ...about(13), subscriptionNotification: { notificationType: 13 } },
    ],
  ])('answers %s and leaves it, without asking Google', async (_name, notification) => {
    const { deliver, asked, billing } = await subscribed()

    const result = await deliver(notification)

    expect(result.response.status).toBe(200)
    expect(result.events).toEqual([])
    expect(result.skipped).toEqual([])
    expect(asked('androidpublisher')).toEqual([])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
  })

  it('reads a notification that Cloud Pub/Sub delivers unwrapped', async () => {
    const { google, deliver } = await subscribed()
    google.subscriptions.set(SUBSCRIPTION, renewed())

    const result = await deliver(about(2), { unwrapped: true })

    expect(result.events.map((event) => event.type)).toEqual(['subscription.renewed'])
  })

  it('answers a purchase nobody handed over yet, and neither grants nor acknowledges it', async () => {
    const { google, billing, deliver, asked } = await shop()
    google.subscriptions.set(SUBSCRIPTION, subscription())

    const early = await deliver(fixture('notification-subscription-purchased'))

    // Not a 409: a second push would read the same purchase and find the same nobody.
    expect(early.response.status).toBe(200)
    expect(early.events).toEqual([])
    expect(early.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])
    expect(asked(':acknowledge')).toEqual([])

    // The hand-over reads the purchase itself; nothing was lost.
    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })
    expect(result.events.map((event) => event.type)).toEqual(['subscription.started'])
    expect(asked(':acknowledge')).toHaveLength(1)

    // And the push that comes after it finds what the hand-over applied.
    const late = await deliver(fixture('notification-subscription-purchased'))
    expect(late.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
  })

  it('renews a subscription with the order and the period Google holds, once', async () => {
    const { google, billing, deliver } = await subscribed()
    google.subscriptions.set(SUBSCRIPTION, renewed())
    vi.setSystemTime(UNTIL)

    const result = await deliver(about(2))
    const again = await deliver(about(2))

    expect(result.response.status).toBe(200)
    expect(result.events).toEqual([
      {
        type: 'subscription.renewed',
        id: `${SUBSCRIPTION_HOLDING}:paid:${ORDER}..0`,
        provider: PROVIDER,
        userId: 'u1',
        product: 'pro',
        holdingId: SUBSCRIPTION_HOLDING,
        occurredAt: new Date(UNTIL),
        currentPeriodEnd: new Date(UNTIL + 30 * DAY),
      },
    ])
    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'active',
      startedAt: new Date(NOW),
      currentPeriodEnd: new Date(UNTIL + 30 * DAY),
    })
  })

  it('reads the purchase as it is now, whatever the notification is about', async () => {
    const { google, deliver } = await subscribed()
    // The push about the purchase arrives late: by now the subscription was renewed.
    google.subscriptions.set(SUBSCRIPTION, renewed())
    vi.setSystemTime(UNTIL)

    const result = await deliver(about(4, SUBSCRIPTION, BOUGHT))

    expect(result.events).toMatchObject([
      { type: 'subscription.renewed', occurredAt: new Date(UNTIL) },
    ])
  })

  it('cancels at the end of what is paid, takes a restart back, and cancels again', async () => {
    const { google, billing, deliver } = await subscribed()
    const canceledAt = (time: number) =>
      subscription(
        {
          ...ACKNOWLEDGED,
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          canceledStateContext: { userInitiatedCancellation: { cancelTime: iso(time) } },
        },
        { autoRenewingPlan: { autoRenewEnabled: false } },
      )

    vi.setSystemTime(BOUGHT + DAY)
    google.subscriptions.set(SUBSCRIPTION, canceledAt(BOUGHT + DAY))
    const canceled = await deliver(about(3))
    expect(canceled.events).toMatchObject([
      {
        type: 'subscription.canceled',
        id: `${SUBSCRIPTION_HOLDING}:canceled:${BOUGHT + DAY}`,
        accessEndsAt: new Date(UNTIL),
      },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
    expect((await billing.entitlements('u1', { now: new Date(UNTIL) })).has('export')).toBe(false)

    vi.setSystemTime(BOUGHT + 2 * DAY)
    google.subscriptions.set(SUBSCRIPTION, subscription(ACKNOWLEDGED))
    const restarted = await deliver(about(7))
    expect(restarted.events).toMatchObject([
      { type: 'subscription.changed', id: `${SUBSCRIPTION_HOLDING}:restarted:${BOUGHT + 2 * DAY}` },
    ])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'active',
      accessEndsAt: null,
    })
    // The same push again changes nothing.
    expect((await deliver(about(7))).events).toEqual([])

    vi.setSystemTime(BOUGHT + 3 * DAY)
    google.subscriptions.set(SUBSCRIPTION, canceledAt(BOUGHT + 3 * DAY))
    const again = await deliver(about(3))
    expect(again.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('canceled')
  })

  it('ends a subscription that has expired, never later than now', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(UNTIL + MINUTE)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )

    const expired = await deliver(about(13))

    expect(expired.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('does not trust an end in the future on a subscription Google calls expired', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(BOUGHT + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )

    await deliver(about(13))

    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: new Date(BOUGHT + DAY),
    })
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('keeps access in the grace period, blocks it on hold, and gives it back when Google is paid', async () => {
    const { google, billing, deliver } = await subscribed()
    const declined = { renewalDeclined: { pendingOrderId: `${ORDER}..0` } }

    vi.setSystemTime(UNTIL + MINUTE)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription(
        {
          ...ACKNOWLEDGED,
          subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
          inGracePeriodStateContext: declined,
        },
        { expiryTime: iso(UNTIL + 3 * DAY) },
      ),
    )
    const grace = await deliver(about(6))
    expect(grace.events).toMatchObject([
      { type: 'payment.failed', id: `${SUBSCRIPTION_HOLDING}:failed:${ORDER}..0` },
    ])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'past_due',
      pastDueSince: new Date(UNTIL + MINUTE),
    })
    expect((await billing.entitlements('u1')).has('export')).toBe(true)

    vi.setSystemTime(UNTIL + 3 * DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({
        ...ACKNOWLEDGED,
        subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD',
        onHoldStateContext: declined,
      }),
    )
    const hold = await deliver(about(5))
    // The failed payment was told before; what is new is that access is over.
    expect(hold.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)

    vi.setSystemTime(UNTIL + 5 * DAY)
    google.subscriptions.set(SUBSCRIPTION, renewed({}, { expiryTime: iso(UNTIL + 35 * DAY) }))
    const recovered = await deliver(about(1))
    expect(recovered.events.map((event) => event.type)).toEqual(['subscription.renewed'])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'active',
      accessEndsAt: null,
      pastDueSince: null,
      currentPeriodEnd: new Date(UNTIL + 35 * DAY),
    })
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
  })

  it('tells a failed payment and the end of access when a subscription goes on hold without a grace period', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(UNTIL + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }),
    )

    const hold = await deliver(about(5))

    expect(hold.events.map((event) => event.type)).toEqual([
      'payment.failed',
      'subscription.canceled',
    ])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: new Date(UNTIL),
    })
  })

  it('ends access while a subscription is paused, and gives it back when it resumes', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(UNTIL + MINUTE)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({
        ...ACKNOWLEDGED,
        subscriptionState: 'SUBSCRIPTION_STATE_PAUSED',
        pausedStateContext: { autoResumeTime: iso(UNTIL + 30 * DAY) },
      }),
    )

    const paused = await deliver(about(10))
    expect(paused.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)

    vi.setSystemTime(UNTIL + 30 * DAY)
    google.subscriptions.set(SUBSCRIPTION, renewed({}, { expiryTime: iso(UNTIL + 60 * DAY) }))
    await deliver(about(1))
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
  })

  it('moves the end of the period when Google defers the renewal', async () => {
    const { google, billing, deliver } = await subscribed()
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription(ACKNOWLEDGED, { expiryTime: iso(UNTIL + 7 * DAY) }),
    )

    const deferred = await deliver(about(9))

    expect(deferred.events).toMatchObject([
      { type: 'subscription.changed', currentPeriodEnd: new Date(UNTIL + 7 * DAY) },
    ])
    expect((await billing.account('u1')).holdings[0]?.currentPeriodEnd).toEqual(
      new Date(UNTIL + 7 * DAY),
    )
  })

  it('refunds a subscription Google revoked', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(BOUGHT + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )

    const revoked = await deliver(about(12))

    expect(revoked.events).toMatchObject([
      { type: 'payment.refunded', id: `${SUBSCRIPTION_HOLDING}:revoked` },
    ])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'refunded',
      accessEndsAt: new Date(BOUGHT + DAY),
    })
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('refunds a subscription whose running period was voided, and tells it once', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(BOUGHT + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )
    const voided = {
      ...fixture('notification-voided'),
      voidedPurchaseNotification: {
        purchaseToken: SUBSCRIPTION,
        orderId: ORDER,
        productType: 1,
        refundType: 1,
      },
    }

    const first = await deliver(voided)
    const second = await deliver(about(12))

    expect(first.events.map((event) => event.type)).toEqual(['payment.refunded'])
    expect(second.events).toEqual([])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('refunded')
  })

  it('ends, and does not refund, a subscription that ran out when an earlier period of it is voided', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(UNTIL + 31 * DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      renewed({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )

    const voided = await deliver({
      ...fixture('notification-voided'),
      voidedPurchaseNotification: {
        purchaseToken: SUBSCRIPTION,
        orderId: ORDER, // the first period; the one that ran last is `${ORDER}..0`
        productType: 1,
        refundType: 1,
      },
    })

    expect(voided.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('canceled')
  })

  it('does not acknowledge a subscription that is not running, whatever Google says is pending', async () => {
    const { google, deliver, asked } = await subscribed()
    vi.setSystemTime(UNTIL + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }), // unacknowledged, as in the fixture
    )

    const hold = await deliver(about(5))

    expect(hold.events.length).toBeGreaterThan(0)
    expect(asked(':acknowledge')).toEqual([])
  })

  it('tells a cancel whose paid period is over as the end it is, and starts nothing', async () => {
    const { google, billing } = await shop()
    vi.setSystemTime(UNTIL + DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({
        ...ACKNOWLEDGED,
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        canceledStateContext: { systemInitiatedCancellation: {} },
      }),
    )

    const result = await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'pro', purchaseToken: SUBSCRIPTION },
    })

    expect(result.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('leaves a subscription that runs when an earlier period of it is voided', async () => {
    const { google, billing, deliver } = await subscribed()
    google.subscriptions.set(SUBSCRIPTION, renewed())
    vi.setSystemTime(UNTIL)
    await deliver(about(2))

    const voided = await deliver({
      ...fixture('notification-voided'),
      voidedPurchaseNotification: {
        purchaseToken: SUBSCRIPTION,
        orderId: ORDER,
        productType: 1,
        refundType: 1,
      },
    })

    expect(voided.events).toEqual([])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
  })

  it('books a change of plan as the new purchase it is at Google, for the same user', async () => {
    const { google, billing, deliver, asked } = await subscribed()
    const upgrade = 'upgrade.AO-J1Oz-made-up-purchase-token-0005'
    const upgradeHolding = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(upgrade))),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    vi.setSystemTime(BOUGHT + 5 * DAY)
    google.subscriptions.set(
      upgrade,
      subscription(
        { startTime: iso(BOUGHT + 5 * DAY), linkedPurchaseToken: SUBSCRIPTION },
        {
          productId: 'team',
          latestSuccessfulOrderId: 'GPA.3345-0000-0000-00005',
          expiryTime: iso(UNTIL + 5 * DAY),
        },
      ),
    )

    // The push arrives without the app: the plan was changed in the Play Store.
    const changed = await deliver(about(4, upgrade))

    expect(changed.response.status).toBe(200)
    expect(changed.events).toEqual([
      {
        type: 'subscription.changed',
        id: `${upgradeHolding}:paid:GPA.3345-0000-0000-00005`,
        provider: PROVIDER,
        userId: 'u1',
        product: 'team',
        holdingId: upgradeHolding,
        replacesHoldingId: SUBSCRIPTION_HOLDING,
        occurredAt: new Date(BOUGHT + 5 * DAY),
        currentPeriodEnd: new Date(UNTIL + 5 * DAY),
      },
    ])
    expect((await billing.account('u1')).holdings).toMatchObject([
      {
        id: SUBSCRIPTION_HOLDING,
        product: 'pro',
        status: 'canceled',
        accessEndsAt: new Date(BOUGHT + 5 * DAY),
      },
      { id: upgradeHolding, product: 'team', status: 'active', accessEndsAt: null },
    ])
    expect((await billing.entitlements('u1')).products).toEqual(['team'])
    expect(asked(':acknowledge').map((call) => call.url)).toEqual([
      expect.stringContaining(`/subscriptions/team/tokens/${upgrade}:acknowledge`),
    ])

    // Its renewal is a renewal, and ends nothing a second time.
    vi.setSystemTime(UNTIL + 5 * DAY)
    google.subscriptions.set(
      upgrade,
      subscription(
        { ...ACKNOWLEDGED, linkedPurchaseToken: SUBSCRIPTION },
        {
          productId: 'team',
          latestSuccessfulOrderId: 'GPA.3345-0000-0000-00005..0',
          expiryTime: iso(UNTIL + 35 * DAY),
        },
      ),
    )
    const next = await deliver(about(2, upgrade))
    expect(next.events.map((event) => event.type)).toEqual(['subscription.renewed'])
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      accessEndsAt: new Date(BOUGHT + 5 * DAY),
    })
  })

  it('tells the purchase that follows another one also where Google carries the order over', async () => {
    const { google, billing, deliver } = await subscribed()
    const follower = 'follower.AO-J1Oz-made-up-purchase-token-0007'
    // The same order and the same period under a new token: nothing was paid anew.
    google.subscriptions.set(follower, subscription({ linkedPurchaseToken: SUBSCRIPTION }))

    const result = await deliver(about(4, follower))

    expect(result.events).toMatchObject([
      { type: 'subscription.changed', replacesHoldingId: SUBSCRIPTION_HOLDING },
    ])
    expect((await billing.account('u1')).holdings.map((holding) => holding.status)).toEqual([
      'canceled',
      'active',
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
  })

  it('refuses a change of plan from another user than the one of the plan it changes', async () => {
    const { google, billing } = await subscribed()
    const upgrade = 'upgrade.AO-J1Oz-made-up-purchase-token-0005'
    google.subscriptions.set(
      upgrade,
      subscription(
        { linkedPurchaseToken: SUBSCRIPTION },
        { productId: 'team', latestSuccessfulOrderId: 'GPA.3345-0000-0000-00005' },
      ),
    )

    const refused = await billing
      .verifyPurchase({ userId: 'u2', proof: { itemId: 'team', purchaseToken: upgrade } })
      .catch((error) => error)

    expect(refused).toBeInstanceOf(BillingPurchaseError)
    expect(refused.reason).toBe('other-user')
    expect((await billing.account('u2')).holdings).toEqual([])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')
  })

  it('ends a purchase Google replaced, also where its paid period would run on', async () => {
    const { google, billing, deliver } = await subscribed()
    vi.setSystemTime(BOUGHT + 5 * DAY)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({
        ...ACKNOWLEDGED,
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        canceledStateContext: { replacementCancellation: {} },
      }),
    )

    const replaced = await deliver(about(3))

    expect(replaced.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(BOUGHT + 5 * DAY) },
    ])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('finds the user of a subscription bought again in the Play Store, and acknowledges it', async () => {
    const { google, billing, deliver, asked } = await subscribed()
    const again = 'resubscribed.AO-J1Oz-made-up-purchase-token-0006'
    vi.setSystemTime(UNTIL + MINUTE)
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )
    await deliver(about(13))

    vi.setSystemTime(UNTIL + 10 * DAY)
    google.subscriptions.set(
      again,
      subscription(
        {
          startTime: iso(UNTIL + 10 * DAY),
          outOfAppPurchaseContext: { expiredPurchaseToken: SUBSCRIPTION },
        },
        { latestSuccessfulOrderId: 'GPA.3345-0000-0000-00006', expiryTime: iso(UNTIL + 40 * DAY) },
      ),
    )
    const result = await deliver(about(4, again))

    expect(result.events).toMatchObject([
      { type: 'subscription.started', userId: 'u1', replacesHoldingId: SUBSCRIPTION_HOLDING },
    ])
    expect(asked(`${again}:acknowledge`)).toHaveLength(1)
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
  })

  it('refunds a one-time purchase that was voided, without asking Google', async () => {
    const { google, billing, deliver, asked } = await shop()
    google.products.set(ONE_TIME, purchase())
    await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
    })
    google.calls.length = 0
    vi.setSystemTime(BOUGHT + DAY)

    const partial = await deliver({
      ...fixture('notification-voided'),
      voidedPurchaseNotification: {
        ...(fixture('notification-voided').voidedPurchaseNotification as Fields),
        refundType: 2,
      },
    })
    expect(partial.events).toEqual([])

    const voided = await deliver(fixture('notification-voided'))
    const again = await deliver(fixture('notification-voided'))

    expect(voided.events).toEqual([
      {
        type: 'payment.refunded',
        id: `${ONE_TIME_HOLDING}:refunded`,
        provider: PROVIDER,
        userId: 'u1',
        product: 'unlock',
        holdingId: ONE_TIME_HOLDING,
        occurredAt: new Date(BOUGHT + DAY),
      },
    ])
    expect(again.events).toEqual([])
    expect(asked('androidpublisher')).toEqual([])
    expect((await billing.entitlements('u1')).has('themes')).toBe(false)
  })

  it('answers the refund of a purchase it does not hold', async () => {
    const { deliver } = await shop()

    const voided = await deliver(fixture('notification-voided'))

    expect(voided.response.status).toBe(200)
    expect(voided.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])
  })

  it('refunds a one-time purchase Google canceled, and completes one it reports as paid', async () => {
    const { google, billing, deliver, asked } = await shop()
    google.products.set(ONE_TIME, purchase())
    await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
    })

    const paid = await deliver(fixture('notification-one-time-purchased'))
    expect(paid.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    // Acknowledged by the hand-over, and not a second time.
    expect(asked(':acknowledge')).toHaveLength(1)

    google.products.set(
      ONE_TIME,
      purchase({ ...ACKNOWLEDGED, purchaseStateContext: { purchaseState: 'CANCELLED' } }),
    )
    const canceled = await deliver({
      ...fixture('notification-one-time-purchased'),
      oneTimeProductNotification: {
        ...(fixture('notification-one-time-purchased').oneTimeProductNotification as Fields),
        notificationType: 2,
      },
    })

    expect(canceled.events.map((event) => event.type)).toEqual(['payment.refunded'])
    expect((await billing.account('u1')).holdings[0]?.status).toBe('refunded')
  })

  it('tells no refund for a one-time purchase that was given up before it was paid', async () => {
    const { google, billing, deliver } = await shop()
    google.products.set(ONE_TIME, purchase())
    await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
    })
    const other = 'never-paid.AO-J1Oz-made-up-purchase-token-0008'
    // Google sets the time of completion once the payment came through; this one never did.
    google.products.set(
      other,
      purchase({
        purchaseStateContext: { purchaseState: 'CANCELLED' },
        purchaseCompletionTime: undefined,
      }),
    )

    const canceled = await deliver({
      ...fixture('notification-one-time-purchased'),
      oneTimeProductNotification: {
        version: '1.0',
        notificationType: 2,
        purchaseToken: other,
        sku: 'unlock',
      },
    })
    const handedOver = await billing
      .verifyPurchase({ userId: 'u1', proof: { itemId: 'unlock', purchaseToken: other } })
      .catch((error) => error)

    expect(canceled.response.status).toBe(200)
    expect(canceled.events).toEqual([])
    expect(canceled.skipped).toEqual([])
    expect(handedOver).toBeInstanceOf(BillingPurchaseError)
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('answers a notification about a purchase Google no longer knows', async () => {
    const { google, deliver, errors } = await subscribed()
    google.failNext('subscriptionsv2', 410, {
      error: { code: 410, message: 'The purchase token is no longer valid.', status: 'GONE' },
    })

    const result = await deliver(about(13))

    expect(result.response.status).toBe(200)
    expect(result.events).toEqual([])
    expect(errors).toEqual([])
  })

  it('answers with 500 when Google fails, so the push comes again', async () => {
    const { google, deliver, errors, billing } = await subscribed()
    google.subscriptions.set(
      SUBSCRIPTION,
      subscription({ ...ACKNOWLEDGED, subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED' }),
    )
    google.failNext('subscriptionsv2', 503)

    const failed = await deliver(about(13))

    expect(failed.response.status).toBe(500)
    expect(String(errors[0])).toMatch(/answered 503 for purchases\.subscriptionsv2\.get/)
    expect(String(errors[0])).not.toContain(SUBSCRIPTION)
    expect((await billing.account('u1')).holdings[0]?.status).toBe('active')

    vi.setSystemTime(UNTIL + MINUTE)
    expect((await deliver(about(13))).events.map((event) => event.type)).toEqual([
      'subscription.canceled',
    ])
  })

  it('answers with 500 when Google does not take the acknowledgement', async () => {
    const { google, billing, deliver, errors, asked } = await subscribed()
    const upgrade = 'upgrade.AO-J1Oz-made-up-purchase-token-0005'
    google.subscriptions.set(
      upgrade,
      subscription(
        { linkedPurchaseToken: SUBSCRIPTION },
        { productId: 'team', latestSuccessfulOrderId: 'GPA.3345-0000-0000-00005' },
      ),
    )
    google.failNext(':acknowledge', 500)

    const failed = await deliver(about(4, upgrade))
    expect(failed.response.status).toBe(500)
    expect(errors).toHaveLength(1)

    const again = await deliver(about(4, upgrade))
    expect(again.response.status).toBe(200)
    expect(asked(':acknowledge')).toHaveLength(2)
    expect((await billing.entitlements('u1')).products).toEqual(['team'])
  })
})

describe('the manage link of Google Play', () => {
  it('leads to the subscription in the Play Store', async () => {
    const { billing } = await subscribed()

    expect(await billing.manageUrl('u1')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=pro&package=com.example.app',
    )
  })

  it('is none for a user who holds no subscription', async () => {
    const { google, billing } = await shop()
    google.products.set(ONE_TIME, purchase())
    await billing.verifyPurchase({
      userId: 'u1',
      proof: { itemId: 'unlock', purchaseToken: ONE_TIME },
    })

    expect(await billing.manageUrl('u1')).toBeNull()
    expect(await billing.manageUrl('u2')).toBeNull()
  })
})
