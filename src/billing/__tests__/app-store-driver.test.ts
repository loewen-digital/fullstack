import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import { readFileSync } from 'node:fs'
import { MemoryAdapter } from '@loewen-digital/flatdb'
import {
  BillingError,
  BillingPurchaseError,
  appStoreAccountToken,
  createAppStoreDriver,
  createBilling,
  createMemoryBillingStore,
} from '../index.js'
import type { BillingStore } from '../index.js'
import {
  APPLE_ROOT_CA_G3,
  AppleSignatureError,
  fromBase64,
  parseCertificate,
  verifyAppleJws,
  verifyChain,
} from '../drivers/app-store-jws.js'
import { createFlatdbBillingStore } from '../stores/flatdb.js'
import { createTestChain } from './app-store-chain.js'
import type { TestChain } from './app-store-chain.js'

// Payloads in the shape of Apple's reference, see fixtures/app-store/README.md. None of them is
// signed: a test signs with a chain it makes for the run, which the driver is told to trust.
type Fields = Record<string, unknown>

function fixture(name: string): Fields {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/app-store/${name}.json`, import.meta.url), 'utf8'),
  ) as Fields
}

const BUNDLE = 'com.example.app'
const PRO = 'com.example.app.pro.monthly'
const TEAM = 'com.example.app.team.monthly'
const UNLOCK = 'com.example.app.unlock'
const CREDITS = 'com.example.app.credits100'
const SUBSCRIPTION = '2000000812345601' // the first transaction of the subscription in the fixtures
const HOUR = 3_600_000
const DAY = 24 * HOUR
const BOUGHT = Date.UTC(2026, 10, 10, 10) // when the fixtures were bought
const UNTIL = Date.UTC(2026, 11, 10, 10) // what the subscription of the fixtures is paid until
const NOW = BOUGHT + 7 * DAY
/** The account token of user `u1`, which the fixtures were bought with */
const TOKEN = 'cbc7db3e-63e2-5b9b-86a6-caf3a40e1481'

let chain: TestChain
beforeAll(async () => {
  chain = await createTestChain()
})
// Only the clock: Web Crypto and the stores keep their real timers.
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

const products = {
  pro: { type: 'subscription', providerId: PRO, features: ['export'] },
  team: { type: 'subscription', providerId: TEAM, features: ['export', 'seats'] },
  unlock: { type: 'one-time', providerId: UNLOCK, features: ['themes'] },
  credits: { type: 'one-time', providerId: CREDITS },
} as const

function shop(
  options: { environment?: 'sandbox' | 'production'; store?: BillingStore; trust?: boolean } = {},
) {
  return createBilling({
    driver: createAppStoreDriver({
      bundleId: BUNDLE,
      environment: options.environment ?? 'sandbox',
      ...(options.trust === false ? {} : { rootCertificates: [chain.root] }),
    }),
    store: options.store ?? createMemoryBillingStore(),
    products,
    // Nothing in these tests may fail inside the webhook route without the test saying so.
    onError: (error) => {
      throw error
    },
  })
}

/** A transaction as the device hands it over: a fixture, some fields replaced, signed */
function proof(name: string, changes: Fields = {}, signer: TestChain = chain): Promise<string> {
  return signer.sign({ ...fixture(name), ...changes })
}

/**
 * A notification about the subscription of the fixtures, derived from the one fixture there is:
 * another type, another time, some fields of its transaction replaced. `of` is another
 * transaction altogether, for a notification about a one-time purchase.
 */
function notification(
  type: string,
  at: number,
  options: { subtype?: string; status?: number; changes?: Fields; of?: Fields; uuid?: string } = {},
): Fields {
  const base = fixture('notification-subscribed')
  const data = base.data as Fields
  const { renewalInfo, status, ...app } = data
  return {
    ...base,
    notificationType: type,
    subtype: options.subtype,
    notificationUUID: options.uuid ?? `${type}.${options.subtype ?? 'none'}.${at}`.toLowerCase(),
    signedDate: at,
    data: {
      ...app,
      // Apple sends the renewal info and the status for subscriptions only.
      ...(options.of ? {} : { renewalInfo, status: options.status ?? status }),
      transaction: {
        ...(options.of ?? (data.transaction as Fields)),
        signedDate: at,
        ...options.changes,
      },
    },
  }
}

/** A delivery as Apple posts it: every part signed on its own, then the whole */
async function delivery(payload: Fields, signer: TestChain = chain): Promise<Request> {
  const data = payload.data as Fields | undefined
  const { transaction, renewalInfo, ...rest } = data ?? {}
  const signedPayload = await signer.sign({
    ...payload,
    ...(data
      ? {
          data: {
            ...rest,
            ...(transaction ? { signedTransactionInfo: await signer.sign(transaction) } : {}),
            ...(renewalInfo ? { signedRenewalInfo: await signer.sign(renewalInfo) } : {}),
          },
        }
      : {}),
  })
  return post({ signedPayload })
}

function post(body: unknown, method = 'POST'): Request {
  return new Request('https://app.example/billing/app-store', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

/** The renewal of the fixtures' subscription: a new transaction of the same purchase */
const renewal = (period = 1): Fields => ({
  transactionId: String(Number(SUBSCRIPTION) + period),
  transactionReason: 'RENEWAL',
  purchaseDate: UNTIL + (period - 1) * 30 * DAY,
  expiresDate: UNTIL + period * 30 * DAY,
})

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

describe('what the App Store signed', () => {
  const apple = fixture('apple-certificates') as {
    rootSha256: string
    intermediate: string
    leaf: string
  }
  const appleRoot = () => parseCertificate(fromBase64(APPLE_ROOT_CA_G3)!)

  it('ships Apple Root CA - G3 as the root it trusts', async () => {
    // The fingerprint of the certificate in the trust store of macOS and in Apple's own library.
    expect(await sha256(fromBase64(APPLE_ROOT_CA_G3)!)).toBe(apple.rootSha256)
    const root = appleRoot()
    expect(root).toMatchObject({ curve: 'P-384', hash: 'SHA-384', ca: true })
    expect(new Date(root.notAfter).toISOString()).toBe('2039-04-30T18:19:06.000Z')
  })

  it('takes the chain Apple signs transactions with, while it is valid', async () => {
    const leaf = parseCertificate(fromBase64(apple.leaf)!)
    const intermediate = parseCertificate(fromBase64(apple.intermediate)!)
    expect(leaf).toMatchObject({ curve: 'P-256', hash: 'SHA-384', ca: false })
    expect(intermediate).toMatchObject({ curve: 'P-384', ca: true })

    await expect(
      verifyChain(leaf, intermediate, [appleRoot()], Date.UTC(2026, 0, 1)),
    ).resolves.toBeUndefined()
    // The leaf is valid from 2025-09-19 to 2027-10-13.
    for (const outside of [Date.UTC(2025, 0, 1), Date.UTC(2028, 0, 1)]) {
      await expect(verifyChain(leaf, intermediate, [appleRoot()], outside)).rejects.toThrow(
        'was not valid when the data was signed',
      )
    }
    // Apple's certificates under another root are nobody's.
    await expect(
      verifyChain(leaf, intermediate, [parseCertificate(chain.root)], Date.UTC(2026, 0, 1)),
    ).rejects.toThrow('does not lead to a trusted root')
    // And the other way round: the intermediate did not issue itself.
    await expect(
      verifyChain(intermediate, intermediate, [appleRoot()], Date.UTC(2026, 0, 1)),
    ).rejects.toThrow('is not issued by its chain')
  })

  it('returns the payload of a JWS whose chain it trusts', async () => {
    const payload = { hello: 'world', signedDate: NOW }
    const roots = [parseCertificate(chain.root)]
    expect(await verifyAppleJws(await chain.sign(payload), roots, NOW)).toEqual(payload)
  })

  it('refuses everything else', async () => {
    const roots = [parseCertificate(chain.root)]
    const payload = { hello: 'world', signedDate: NOW }
    const other = await createTestChain()
    const encode = (value: unknown): string => btoa(JSON.stringify(value)).replace(/=+$/, '')
    const [header, body, signature] = (await chain.sign(payload)).split('.') as [
      string,
      string,
      string,
    ]

    const refused: [string, unknown, string][] = [
      [
        'a changed payload',
        `${header}.${encode({ ...payload, hello: 'you' })}.${signature}`,
        'does not match',
      ],
      [
        'the signature of another key',
        await other.sign(payload, { x5c: chain.x5c }),
        'does not match',
      ],
      ['no signature', `${header}.${body}.`, 'not one of ES256'],
      ['another algorithm', await chain.sign(payload, { alg: 'HS256' }), 'not signed with ES256'],
      ['no algorithm', await chain.sign(payload, { alg: 'none' }), 'not signed with ES256'],
      [
        'a chain of two',
        await chain.sign(payload, { x5c: chain.x5c.slice(0, 2) }),
        'no chain of three',
      ],
      ['no chain', await chain.sign(payload, { x5c: undefined }), 'no chain of three'],
      ['the chain of another root', await other.sign(payload), 'does not lead to a trusted root'],
      [
        'a leaf of another chain',
        await other.sign(payload, { x5c: [other.x5c[0], chain.x5c[1], chain.x5c[2]] }),
        'is not issued by its chain',
      ],
      [
        'a certificate that is none',
        await chain.sign(payload, { x5c: [btoa('not a certificate'), chain.x5c[1], chain.x5c[2]] }),
        'certificate',
      ],
      ['two parts', `${header}.${body}`, 'not a JWS'],
      ['an object', { signedPayload: 'x' }, 'not a string'],
      ['a header that is no JSON', `x.${body}.${signature}`, 'header'],
    ]
    for (const [what, jws, message] of refused) {
      const result = verifyAppleJws(jws, roots, NOW)
      await expect(result, what).rejects.toThrow(AppleSignatureError)
      await expect(result, what).rejects.toThrow(message)
    }
  })

  it('refuses a chain without the marks of the App Store', async () => {
    const payload = { signedDate: NOW }
    const cases: [Parameters<typeof createTestChain>[0], string][] = [
      [{ leafMarker: false }, 'not one the App Store signs with'],
      [{ intermediateMarker: false }, 'not one of Apple Worldwide Developer Relations'],
      [{ intermediateCa: false }, 'may not sign certificates'],
      [{ leafCurve: 'P-384' }, 'not one of ES256'],
      // The right key under another name: a certificate is its issuer's by name as well.
      [{ leafIssuerName: 'Somebody Else' }, 'is not issued by its chain'],
    ]
    for (const [options, message] of cases) {
      const marked = await createTestChain(options)
      await expect(
        verifyAppleJws(await marked.sign(payload), [parseCertificate(marked.root)], NOW),
      ).rejects.toThrow(message)
    }
  })

  it('checks the certificates at the time the data was signed', async () => {
    const expired = await createTestChain({ leafNotAfter: new Date(NOW - DAY) })
    const roots = [parseCertificate(expired.root)]
    // Signed while the certificate was valid: verifiable for good, as a stored transaction is.
    await expect(
      verifyAppleJws(await expired.sign({ signedDate: NOW - 2 * DAY }), roots, NOW),
    ).resolves.toEqual({ signedDate: NOW - 2 * DAY })
    // Signed after it ran out, or without a date, which is judged by now.
    for (const payload of [{ signedDate: NOW }, {}, { signedDate: 'yesterday' }]) {
      await expect(verifyAppleJws(await expired.sign(payload), roots, NOW)).rejects.toThrow(
        'was not valid when the data was signed',
      )
    }
  })
})

describe('the App Store driver', () => {
  it('needs the app and the environment, and trusts Apple unless told otherwise', () => {
    const config = { bundleId: BUNDLE, environment: 'sandbox' } as const
    expect(createAppStoreDriver(config).name).toBe('app-store')
    expect(() => createAppStoreDriver({ ...config, bundleId: '' })).toThrow(BillingError)
    expect(() => createAppStoreDriver({ ...config, environment: 'xcode' as never })).toThrow(
      "'production' or 'sandbox'",
    )
    expect(() => createAppStoreDriver({ ...config, rootCertificates: [] })).toThrow(
      'leave it out to trust Apple',
    )
    expect(() => createAppStoreDriver({ ...config, rootCertificates: ['bm9wZQ=='] })).toThrow(
      'rootCertificates[0]',
    )
    // A root as DER bytes, as base64 and as PEM.
    const base64 = btoa(String.fromCharCode(...chain.root))
    const pem = `-----BEGIN CERTIFICATE-----\n${base64.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`
    for (const root of [chain.root, base64, pem]) {
      expect(createAppStoreDriver({ ...config, rootCertificates: [root] }).name).toBe('app-store')
    }
  })

  it('starts no checkout: the purchase is made on the device', async () => {
    await expect(shop().checkout({ userId: 'u1', product: 'pro' })).rejects.toThrow(
      'starts on the device',
    )
  })

  it('derives the account token of a user, the same every time', async () => {
    // Checked against uuid.uuid5 of Python, in the namespace of the driver.
    expect(await appStoreAccountToken('u1')).toBe(TOKEN)
    expect(await appStoreAccountToken('u2')).toBe('301474c1-1980-5878-a738-b22ed4e32f6e')
    expect(await appStoreAccountToken('u1')).toBe(TOKEN)
    await expect(appStoreAccountToken('')).rejects.toThrow(BillingError)
  })
})

describe('a purchase the app hands over', () => {
  it('applies a one-time purchase', async () => {
    const billing = shop()
    const { events, skipped } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-non-consumable'),
    })

    expect(skipped).toEqual([])
    expect(events).toEqual([
      {
        type: 'purchase.completed',
        id: '2000000812345701',
        provider: 'app-store',
        occurredAt: new Date(BOUGHT),
        userId: 'u1',
        product: 'unlock',
        holdingId: '2000000812345701',
      },
    ])
    const account = await billing.account('u1')
    expect(account.holdings).toMatchObject([
      { provider: 'app-store', id: '2000000812345701', product: 'unlock', status: 'active' },
    ])
    // The customer at Apple is the account token: later notifications find the user through it.
    expect(account.customers).toEqual({ 'app-store': TOKEN })
    expect((await billing.entitlements('u1')).has('themes')).toBe(true)
  })

  it('applies a subscription with the date it is paid until', async () => {
    const billing = shop()
    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription'),
    })

    expect(events).toMatchObject([
      {
        type: 'subscription.started',
        id: SUBSCRIPTION,
        product: 'pro',
        holdingId: SUBSCRIPTION,
        occurredAt: new Date(BOUGHT),
        currentPeriodEnd: new Date(UNTIL),
      },
    ])
    expect((await billing.account('u1')).holdings).toMatchObject([
      { type: 'subscription', status: 'active', currentPeriodEnd: new Date(UNTIL) },
    ])
  })

  it('applies a consumable as a purchase of its own', async () => {
    const billing = shop()
    const first = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-consumable'),
    })
    const second = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-consumable', {
        transactionId: '2000000812345802',
        originalTransactionId: '2000000812345802',
      }),
    })

    expect(first.events).toMatchObject([{ type: 'purchase.completed', product: 'credits' }])
    expect(second.events).toMatchObject([{ id: '2000000812345802', product: 'credits' }])
    expect((await billing.account('u1')).holdings).toHaveLength(2)
  })

  it('applies a renewal to the subscription it renews', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-subscription') })
    vi.setSystemTime(UNTIL + HOUR)
    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription', { ...renewal(), signedDate: UNTIL + HOUR }),
    })

    expect(events).toMatchObject([
      {
        type: 'subscription.renewed',
        holdingId: SUBSCRIPTION,
        currentPeriodEnd: new Date(UNTIL + 30 * DAY),
      },
    ])
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('applies a purchase once, however often it is handed over', async () => {
    const billing = shop()
    const jws = await proof('transaction-subscription')
    await billing.verifyPurchase({ userId: 'u1', proof: jws })
    // The device hands a transaction over on every start; Apple signs it anew each time.
    const again = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription', { signedDate: NOW }),
    })

    expect(again.events).toEqual([])
    expect(again.skipped).toMatchObject([{ reason: 'duplicate' }])
  })

  it('refuses a purchase that was made for another user', async () => {
    const billing = shop()
    const jws = await proof('transaction-subscription')

    const refused = billing.verifyPurchase({ userId: 'u2', proof: jws })
    await expect(refused).rejects.toThrow(BillingPurchaseError)
    await expect(refused).rejects.toMatchObject({ reason: 'other-user' })
    expect((await billing.account('u2')).holdings).toEqual([])
    // And it is still there for the user it was made for.
    await billing.verifyPurchase({ userId: 'u1', proof: jws })
    expect((await billing.entitlements('u1')).has('export')).toBe(true)
  })

  it('refuses a purchase that names no account', async () => {
    const billing = shop()
    for (const appAccountToken of [undefined, '', 'u1', 42]) {
      const refused = billing.verifyPurchase({
        userId: 'u1',
        proof: await proof('transaction-subscription', { appAccountToken }),
      })
      await expect(refused).rejects.toMatchObject({ reason: 'invalid' })
      await expect(refused).rejects.toThrow('appAccountToken')
    }
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('takes the account token however Apple writes it', async () => {
    const billing = shop()
    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription', { appAccountToken: TOKEN.toUpperCase() }),
    })
    expect(events).toHaveLength(1)
    expect((await billing.account('u1')).customers).toEqual({ 'app-store': TOKEN })
  })

  it('refuses what is not a transaction of this app, this environment and Apple', async () => {
    const billing = shop()
    const stranger = await createTestChain()
    const jws = await proof('transaction-subscription')
    const refused: [string, unknown, string][] = [
      ['a claim', { product: 'pro', paid: true }, 'not a string'],
      ['a changed transaction', `${jws.slice(0, -8)}AAAAAAAA`, 'does not match'],
      [
        'a chain nobody trusts',
        await proof('transaction-subscription', {}, stranger),
        'trusted root',
      ],
      [
        'another app',
        await proof('transaction-subscription', { bundleId: 'com.example.other' }),
        'another app',
      ],
      [
        'production',
        await proof('transaction-subscription', { environment: 'Production' }),
        "not from Apple's sandbox",
      ],
      [
        'a build run from Xcode',
        await proof('transaction-subscription', { environment: 'Xcode' }),
        "not from Apple's sandbox",
      ],
      [
        'no environment',
        await proof('transaction-subscription', { environment: undefined }),
        "not from Apple's sandbox",
      ],
      ['no id', await proof('transaction-subscription', { transactionId: undefined }), 'no id'],
      [
        'an id no store could keep',
        await proof('transaction-subscription', { transactionId: '../x' }),
        'no id',
      ],
      [
        'a kind of purchase it does not know',
        await proof('transaction-subscription', { type: 'Something New' }),
        'of a kind the driver does not know',
      ],
      [
        'no kind of purchase',
        await proof('transaction-subscription', { type: undefined }),
        'of a kind the driver does not know',
      ],
      [
        'a subscription without an end',
        await proof('transaction-subscription', { expiresDate: undefined }),
        'no date it is paid until',
      ],
      [
        'a purchase shared in a family',
        await proof('transaction-subscription', { inAppOwnershipType: 'FAMILY_SHARED' }),
        'shared with this customer',
      ],
    ]
    for (const [what, proofOf, message] of refused) {
      const result = billing.verifyPurchase({ userId: 'u1', proof: proofOf })
      await expect(result, what).rejects.toMatchObject({ reason: 'invalid' })
      await expect(result, what).rejects.toThrow(message)
    }
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('never puts the proof into the message of a refusal', async () => {
    const jws = await proof('transaction-subscription', { bundleId: 'com.example.other' })
    const error: unknown = await shop()
      .verifyPurchase({ userId: 'u1', proof: jws })
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(BillingPurchaseError)
    const message = (error as Error).message
    for (const part of jws.split('.')) expect(message).not.toContain(part)
    expect(message).not.toContain(TOKEN)
  })

  it('trusts nothing but Apple without `rootCertificates`', async () => {
    // The same transaction the tests above take, at a driver as an app configures it.
    const billing = shop({ trust: false })
    await expect(
      billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-subscription') }),
    ).rejects.toThrow('does not lead to a trusted root')
  })

  it('keeps sandbox and production apart', async () => {
    const live = shop({ environment: 'production' })
    const sandboxed = await proof('transaction-subscription')
    const paid = await proof('transaction-subscription', { environment: 'Production' })

    await expect(live.verifyPurchase({ userId: 'u1', proof: sandboxed })).rejects.toThrow(
      "not from Apple's production environment",
    )
    expect((await live.account('u1')).holdings).toEqual([])
    expect((await live.verifyPurchase({ userId: 'u1', proof: paid })).events).toHaveLength(1)
  })

  it('starts nothing from a subscription period that is over', async () => {
    const billing = shop()
    vi.setSystemTime(UNTIL)
    const { events, skipped } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription'),
    })

    expect(events).toEqual([])
    expect(skipped).toEqual([])
    expect((await billing.account('u1')).holdings).toEqual([])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('starts nothing from a transaction an upgrade replaced', async () => {
    const billing = shop()
    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription', { isUpgraded: true }),
    })
    expect(events).toEqual([])
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('applies a refunded purchase as refunded', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })
    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-non-consumable', {
        revocationDate: BOUGHT + DAY,
        revocationReason: 0,
        revocationType: 'REFUND_FULL',
        signedDate: NOW,
      }),
    })

    expect(events).toMatchObject([
      {
        type: 'payment.refunded',
        id: `2000000812345701:revoked:${BOUGHT + DAY}`,
        occurredAt: new Date(BOUGHT + DAY),
      },
    ])
    expect((await billing.account('u1')).holdings).toMatchObject([{ status: 'refunded' }])
    expect((await billing.entitlements('u1')).has('themes')).toBe(false)
  })

  it('skips a product the config does not sell', async () => {
    const billing = shop()
    const { events, skipped } = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-non-consumable', { productId: 'com.example.app.other' }),
    })
    expect(events).toEqual([])
    expect(skipped).toMatchObject([{ reason: 'unknown-product' }])
  })

  it('says so when the config and Apple disagree on what a product is', async () => {
    const billing = shop()
    const mismatch = billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-non-consumable', { productId: PRO }),
    })
    await expect(mismatch).rejects.toThrow('product "pro" is subscription in the config')
    await expect(mismatch).rejects.not.toBeInstanceOf(BillingPurchaseError)
    expect((await billing.account('u1')).holdings).toEqual([])
  })
})

describe('App Store Server Notifications', () => {
  /** A shop where `u1` has handed the subscription of the fixtures over */
  async function subscribed(store?: BillingStore) {
    const billing = shop({ store })
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-subscription') })
    const holding = async () => (await billing.account('u1')).holdings[0]!
    const grants = async () => (await billing.entitlements('u1')).has('export')
    const deliver = async (payload: Fields) => billing.handleWebhook(await delivery(payload))
    return { billing, holding, grants, deliver }
  }

  it('is the same event as the proof of the purchase, whichever comes first', async () => {
    const billing = shop()
    const before = await billing.handleWebhook(await delivery(fixture('notification-subscribed')))
    // Nobody handed the purchase over yet: Apple delivers again.
    expect(before.response.status).toBe(409)
    expect(before.skipped).toMatchObject([{ reason: 'unmatched' }])

    const handed = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription'),
    })
    expect(handed.events).toMatchObject([{ type: 'subscription.started', id: SUBSCRIPTION }])

    const after = await billing.handleWebhook(await delivery(fixture('notification-subscribed')))
    expect(after.response.status).toBe(200)
    expect(after.events).toEqual([])
    expect(after.skipped).toMatchObject([{ reason: 'duplicate' }])
  })

  it('finds the user of a new purchase through the account token of an earlier one', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })

    // The subscription was bought and never handed over: the notification brings it.
    const { response, events } = await billing.handleWebhook(
      await delivery(fixture('notification-subscribed')),
    )
    expect(response.status).toBe(200)
    expect(events).toMatchObject([{ type: 'subscription.started', userId: 'u1', product: 'pro' }])

    const charge = await billing.handleWebhook(
      await delivery(
        notification('ONE_TIME_CHARGE', NOW, { of: fixture('transaction-consumable') }),
      ),
    )
    expect(charge.events).toMatchObject([{ type: 'purchase.completed', product: 'credits' }])
  })

  it('answers a test notification and anything it has no use for with 200', async () => {
    const billing = shop()
    const quiet = [
      fixture('notification-test'),
      notification('PRICE_INCREASE', NOW, { subtype: 'PENDING' }),
      notification('RENEWAL_EXTENDED', NOW),
      notification('CONSUMPTION_REQUEST', NOW),
      // A summary carries no `data`.
      {
        notificationType: 'RENEWAL_EXTENSION',
        subtype: 'SUMMARY',
        notificationUUID: 'summary-1',
        signedDate: NOW,
        version: '2.0',
        summary: { bundleId: BUNDLE, environment: 'Sandbox' },
      },
      // A purchase a family member shares is not sold through billing.
      notification('SUBSCRIBED', NOW, {
        changes: { inAppOwnershipType: 'FAMILY_SHARED', appAccountToken: undefined },
      }),
    ]
    for (const payload of quiet) {
      const result = await billing.handleWebhook(await delivery(payload))
      expect(result.response.status, String(payload.notificationType)).toBe(200)
      expect(result.events).toEqual([])
      expect(result.skipped).toEqual([])
    }
  })

  it('refuses what is not a notification of this app, this environment and Apple', async () => {
    const billing = shop()
    const stranger = await createTestChain()
    const good = fixture('notification-subscribed')
    const data = good.data as Fields
    const { signedPayload } = (await (await delivery(good)).json()) as { signedPayload: string }

    const refused: [string, Request, number, string][] = [
      ['a GET', post(null, 'GET'), 405, 'POST'],
      ['no JSON', post('signedPayload=x'), 400, 'not JSON'],
      ['no signed payload', post({ notificationType: 'SUBSCRIBED' }), 400, 'version 2'],
      [
        'a version 1 notification',
        post({ notification_type: 'DID_RENEW', password: 'x' }),
        400,
        'version 2',
      ],
      [
        'a changed payload',
        post({ signedPayload: `${signedPayload.slice(0, -8)}AAAAAAAA` }),
        401,
        'does not match',
      ],
      ['a chain nobody trusts', await delivery(good, stranger), 401, 'trusted root'],
      [
        'another app',
        await delivery({ ...good, data: { ...data, bundleId: 'com.example.other' } }),
        400,
        'another app',
      ],
      [
        'production',
        await delivery({ ...good, data: { ...data, environment: 'Production' } }),
        400,
        "not from Apple's sandbox",
      ],
      ['no id', await delivery({ ...good, notificationUUID: undefined }), 400, 'version 2'],
      // The envelope is this app's, the transaction inside is not.
      [
        'a transaction of another app',
        await delivery(
          notification('SUBSCRIBED', NOW, { changes: { bundleId: 'com.example.other' } }),
        ),
        400,
        'another app',
      ],
      [
        'a transaction of production',
        await delivery(notification('SUBSCRIBED', NOW, { changes: { environment: 'Production' } })),
        400,
        "not from Apple's sandbox",
      ],
    ]
    for (const [what, request, status, message] of refused) {
      const { response, events } = await billing.handleWebhook(request)
      expect(response.status, what).toBe(status)
      expect(((await response.json()) as { error: string }).error, what).toContain(message)
      expect(events).toEqual([])
    }
  })

  it('refuses a transaction inside a notification that Apple did not sign', async () => {
    const billing = shop()
    const stranger = await createTestChain()
    const good = fixture('notification-subscribed')
    const { transaction, ...data } = good.data as Fields
    const signedPayload = await chain.sign({
      ...good,
      data: {
        ...data,
        renewalInfo: undefined,
        signedTransactionInfo: await stranger.sign(transaction),
      },
    })

    const { response } = await billing.handleWebhook(post({ signedPayload }))
    expect(response.status).toBe(401)
  })

  it('ends a subscription whose renewal was turned off, at the end of what is paid', async () => {
    const { deliver, holding, grants, billing } = await subscribed()
    const { response, events } = await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
        subtype: 'AUTO_RENEW_DISABLED',
      }),
    )

    expect(response.status).toBe(200)
    expect(events).toMatchObject([
      { type: 'subscription.canceled', holdingId: SUBSCRIPTION, accessEndsAt: new Date(UNTIL) },
    ])
    expect(await holding()).toMatchObject({ status: 'canceled', accessEndsAt: new Date(UNTIL) })
    expect(await grants()).toBe(true)
    expect((await billing.entitlements('u1', { now: new Date(UNTIL) })).has('export')).toBe(false)
  })

  it('takes a cancel back when renewal is turned on again', async () => {
    const { deliver, holding } = await subscribed()
    await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
        subtype: 'AUTO_RENEW_DISABLED',
      }),
    )
    const { events } = await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 3 * DAY, {
        subtype: 'AUTO_RENEW_ENABLED',
      }),
    )

    expect(events).toMatchObject([
      { type: 'subscription.changed', currentPeriodEnd: new Date(UNTIL) },
    ])
    expect(await holding()).toMatchObject({ status: 'active', accessEndsAt: null })
  })

  it('applies a notification once, however often Apple delivers it', async () => {
    const { deliver } = await subscribed()
    const cancel = notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
      subtype: 'AUTO_RENEW_DISABLED',
    })
    expect((await deliver(cancel)).events).toHaveLength(1)

    const again = await deliver(cancel)
    expect(again.response.status).toBe(200)
    expect(again.events).toEqual([])
    expect(again.skipped.map((skip) => skip.reason)).toEqual(['duplicate', 'duplicate'])
  })

  it('renews, and a cancel after an early renewal still counts', async () => {
    const { deliver, holding } = await subscribed()
    // Apple charges a renewal before its period starts: the purchase date is still ahead.
    vi.setSystemTime(UNTIL - 6 * HOUR)
    const renewed = await deliver(
      notification('DID_RENEW', UNTIL - 6 * HOUR, { changes: renewal() }),
    )
    expect(renewed.events).toMatchObject([
      {
        type: 'subscription.renewed',
        id: String(Number(SUBSCRIPTION) + 1),
        holdingId: SUBSCRIPTION,
        occurredAt: new Date(UNTIL - 6 * HOUR),
        currentPeriodEnd: new Date(UNTIL + 30 * DAY),
      },
    ])
    expect(await holding()).toMatchObject({
      status: 'active',
      currentPeriodEnd: new Date(UNTIL + 30 * DAY),
    })

    const canceled = await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', UNTIL - 3 * HOUR, {
        subtype: 'AUTO_RENEW_DISABLED',
        changes: renewal(),
      }),
    )
    expect(canceled.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL + 30 * DAY) },
    ])
    expect(await holding()).toMatchObject({ status: 'canceled' })
  })

  it('never lets an older transaction undo what came after it', async () => {
    const { deliver, holding, billing } = await subscribed()
    await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
        subtype: 'AUTO_RENEW_DISABLED',
      }),
    )
    // The device hands the first transaction over again, signed just now.
    const again = await billing.verifyPurchase({
      userId: 'u1',
      proof: await proof('transaction-subscription', { signedDate: NOW }),
    })

    expect(again.events).toEqual([])
    expect(await holding()).toMatchObject({ status: 'canceled', accessEndsAt: new Date(UNTIL) })
  })

  it('keeps access through a grace period, and ends it when the grace period does', async () => {
    const { deliver, holding, grants } = await subscribed()
    vi.setSystemTime(UNTIL + HOUR)
    const failed = await deliver(
      notification('DID_FAIL_TO_RENEW', UNTIL, { subtype: 'GRACE_PERIOD', status: 4 }),
    )
    expect(failed.events).toMatchObject([{ type: 'payment.failed', holdingId: SUBSCRIPTION }])
    expect(await holding()).toMatchObject({ status: 'past_due', pastDueSince: new Date(UNTIL) })
    expect(await grants()).toBe(true)

    vi.setSystemTime(UNTIL + 16 * DAY + HOUR)
    const over = await deliver(
      notification('GRACE_PERIOD_EXPIRED', UNTIL + 16 * DAY, { status: 3 }),
    )
    expect(over.events).toMatchObject([
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL + 16 * DAY) },
    ])
    expect(await grants()).toBe(false)

    // Apple got the payment after all: a renewal after a lapse.
    const recovered = await deliver(
      notification('DID_RENEW', UNTIL + 17 * DAY, {
        subtype: 'BILLING_RECOVERY',
        changes: { ...renewal(), purchaseDate: UNTIL + 17 * DAY, expiresDate: UNTIL + 47 * DAY },
      }),
    )
    expect(recovered.events).toMatchObject([{ type: 'subscription.renewed' }])
    expect(await holding()).toMatchObject({
      status: 'active',
      accessEndsAt: null,
      pastDueSince: null,
    })
    expect(await grants()).toBe(true)
  })

  it('ends access with the paid period when a payment fails without a grace period', async () => {
    const { deliver, holding, grants } = await subscribed()
    vi.setSystemTime(UNTIL + HOUR)
    const { response, events } = await deliver(
      notification('DID_FAIL_TO_RENEW', UNTIL, { status: 3 }),
    )

    expect(response.status).toBe(200)
    // The app hears of the failed payment, and the subscription is over with what was paid.
    expect(events).toMatchObject([
      { type: 'payment.failed' },
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) },
    ])
    expect(new Set(events.map((event) => event.id)).size).toBe(2)
    expect(await holding()).toMatchObject({ status: 'canceled', pastDueSince: null })
    expect(await grants()).toBe(false)
  })

  it('ends a subscription that expired', async () => {
    const { deliver, holding, grants } = await subscribed()
    vi.setSystemTime(UNTIL + HOUR)
    const { events } = await deliver(
      notification('EXPIRED', UNTIL, { subtype: 'VOLUNTARY', status: 2 }),
    )

    expect(events).toMatchObject([{ type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) }])
    expect(await holding()).toMatchObject({ status: 'canceled' })
    expect(await grants()).toBe(false)
  })

  it('starts nothing from a notification that arrives after its period is over', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })
    vi.setSystemTime(UNTIL + DAY)

    // The purchase of the subscription, delivered late: on its own it would start a
    // subscription that nothing ends.
    const late = await billing.handleWebhook(await delivery(fixture('notification-subscribed')))
    expect(late.response.status).toBe(200)
    expect(late.events).toEqual([])

    // What ended it still tells that there was one.
    const expired = await billing.handleWebhook(
      await delivery(notification('EXPIRED', UNTIL, { subtype: 'VOLUNTARY', status: 2 })),
    )
    expect(expired.events).toMatchObject([{ type: 'subscription.canceled', product: 'pro' }])
    expect((await billing.entitlements('u1')).has('export')).toBe(false)
  })

  it('applies an upgrade as a change of the product', async () => {
    const { deliver, holding } = await subscribed()
    const upgrade = {
      transactionId: '2000000812345650',
      productId: TEAM,
      purchaseDate: BOUGHT + 3 * DAY,
      expiresDate: BOUGHT + 33 * DAY,
    }
    const { events } = await deliver(
      notification('DID_CHANGE_RENEWAL_PREF', BOUGHT + 3 * DAY + 2000, {
        subtype: 'UPGRADE',
        changes: upgrade,
      }),
    )

    expect(events).toMatchObject([
      {
        type: 'subscription.changed',
        id: '2000000812345650',
        product: 'team',
        holdingId: SUBSCRIPTION,
      },
    ])
    expect(await holding()).toMatchObject({
      product: 'team',
      currentPeriodEnd: new Date(BOUGHT + 33 * DAY),
    })

    // A downgrade waits for the next renewal: nothing changes now.
    const downgrade = await deliver(
      notification('DID_CHANGE_RENEWAL_PREF', BOUGHT + 4 * DAY, {
        subtype: 'DOWNGRADE',
        changes: upgrade,
      }),
    )
    expect(downgrade.events).toEqual([])
    expect(await holding()).toMatchObject({ product: 'team', status: 'active' })
  })

  it('applies a refund, and takes it back when Apple reverses it', async () => {
    const { deliver, holding, grants } = await subscribed()
    const refunded = await deliver(
      notification('REFUND', BOUGHT + 5 * DAY, {
        status: 5,
        changes: {
          revocationDate: BOUGHT + 5 * DAY,
          revocationReason: 1,
          revocationType: 'REFUND_FULL',
        },
      }),
    )
    expect(refunded.events).toMatchObject([{ type: 'payment.refunded', holdingId: SUBSCRIPTION }])
    expect(await holding()).toMatchObject({ status: 'refunded' })
    expect(await grants()).toBe(false)

    const reversed = await deliver(notification('REFUND_REVERSED', BOUGHT + 6 * DAY))
    expect(reversed.events).toMatchObject([
      { type: 'subscription.renewed', currentPeriodEnd: new Date(UNTIL) },
    ])
    expect(await holding()).toMatchObject({ status: 'active', accessEndsAt: null })
    expect(await grants()).toBe(true)
  })

  it('leaves a subscription alone when an earlier period of it is refunded', async () => {
    const { deliver, holding, grants } = await subscribed()
    vi.setSystemTime(UNTIL + 5 * DAY)
    await deliver(notification('DID_RENEW', UNTIL, { changes: renewal() }))

    // The first period, which was over when the money went back.
    const { response, events } = await deliver(
      notification('REFUND', UNTIL + 4 * DAY, { changes: { revocationDate: UNTIL + 4 * DAY } }),
    )
    expect(response.status).toBe(200)
    expect(events).toEqual([])
    expect(await holding()).toMatchObject({ status: 'active' })
    expect(await grants()).toBe(true)
  })

  it('applies the refund of a one-time purchase and its reversal', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })
    const unlock = fixture('transaction-non-consumable')

    const refunded = await billing.handleWebhook(
      await delivery(
        notification('REFUND', BOUGHT + DAY, {
          of: unlock,
          changes: { revocationDate: BOUGHT + DAY },
        }),
      ),
    )
    expect(refunded.events).toMatchObject([{ type: 'payment.refunded', product: 'unlock' }])
    expect((await billing.entitlements('u1')).has('themes')).toBe(false)

    const reversed = await billing.handleWebhook(
      await delivery(notification('REFUND_REVERSED', BOUGHT + 2 * DAY, { of: unlock })),
    )
    expect(reversed.events).toMatchObject([{ type: 'purchase.completed', product: 'unlock' }])
    expect((await billing.entitlements('u1')).has('themes')).toBe(true)
  })

  it('brings the purchase with it when the notification of the purchase was lost', async () => {
    const billing = shop()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })

    // The first the server hears of the subscription is its cancel.
    const { events } = await billing.handleWebhook(
      await delivery(
        notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
          subtype: 'AUTO_RENEW_DISABLED',
        }),
      ),
    )
    expect(events).toMatchObject([
      { type: 'subscription.started', occurredAt: new Date(BOUGHT) },
      { type: 'subscription.canceled', accessEndsAt: new Date(UNTIL) },
    ])
    expect((await billing.account('u1')).holdings[1]).toMatchObject({
      product: 'pro',
      status: 'canceled',
      startedAt: new Date(BOUGHT),
      currentPeriodEnd: new Date(UNTIL),
    })
  })

  it('keeps its ids in a flatdb store', async () => {
    const adapter = new MemoryAdapter()
    const { deliver, holding } = await subscribed(createFlatdbBillingStore({ adapter }))
    await deliver(
      notification('DID_CHANGE_RENEWAL_STATUS', BOUGHT + 2 * DAY, {
        subtype: 'AUTO_RENEW_DISABLED',
      }),
    )

    expect(await holding()).toMatchObject({ provider: 'app-store', status: 'canceled' })
    // The links of the purchase and of the account token, which later notifications are found by.
    for (const key of [`holding/app-store~3a${SUBSCRIPTION}`, `customer/app-store~3a${TOKEN}`]) {
      expect(JSON.parse((await adapter.read(`billing/refs/${key}.json`))!)).toEqual({
        userId: 'u1',
      })
    }
  })
})

describe('the manage link and the two environments', () => {
  it("is Apple's page for subscriptions, for a user who has one", async () => {
    const billing = shop()
    expect(await billing.manageUrl('u1')).toBeNull()
    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-non-consumable') })
    // A one-time purchase has nothing to manage.
    expect(await billing.manageUrl('u1')).toBeNull()

    await billing.verifyPurchase({ userId: 'u1', proof: await proof('transaction-subscription') })
    expect(await billing.manageUrl('u1')).toBe('https://apps.apple.com/account/subscriptions')
  })

  it('runs sandbox and production side by side, as two providers', async () => {
    const driver = (environment: 'production' | 'sandbox') =>
      createAppStoreDriver({ bundleId: BUNDLE, environment, rootCertificates: [chain.root] })
    const billing = createBilling({
      drivers: { app: driver('production'), 'app-sandbox': driver('sandbox') },
      store: createMemoryBillingStore(),
      products: {
        pro: {
          type: 'subscription',
          providerId: { app: PRO, 'app-sandbox': PRO },
          features: ['export'],
        },
      },
    })
    const sandboxed = await proof('transaction-subscription')
    const paid = await proof('transaction-subscription', {
      environment: 'Production',
      transactionId: '510001234567890',
      originalTransactionId: '510001234567890',
    })

    // Free purchases never land where paid ones are kept.
    await expect(
      billing.verifyPurchase({ provider: 'app', userId: 'u1', proof: sandboxed }),
    ).rejects.toMatchObject({ reason: 'invalid' })
    await expect(
      billing.verifyPurchase({ provider: 'app-sandbox', userId: 'u1', proof: paid }),
    ).rejects.toMatchObject({ reason: 'invalid' })

    await billing.verifyPurchase({ provider: 'app-sandbox', userId: 'u1', proof: sandboxed })
    await billing.verifyPurchase({ provider: 'app', userId: 'u1', proof: paid })
    expect((await billing.account('u1')).holdings.map((holding) => holding.provider)).toEqual([
      'app-sandbox',
      'app',
    ])

    // Each webhook route hands its request to its own provider.
    const wrong = await billing.handleWebhook(await delivery(fixture('notification-test')), {
      provider: 'app',
    })
    expect(wrong.response.status).toBe(400)
    const right = await billing.handleWebhook(await delivery(fixture('notification-test')), {
      provider: 'app-sandbox',
    })
    expect(right.response.status).toBe(200)
  })
})
