import { describe, it, expect } from 'vite-plus/test'
import {
  NotificationsError,
  PushDeviceError,
  WEB_PUSH_MAX_PAYLOAD,
  createMemoryDeviceStore,
  createNotifications,
  createWebPushDriver,
  generateVapidKeys,
  webPushHosts,
} from '../index.js'
import type { PushPayload, VapidKeys, WebPushDeviceInput, WebPushDriverConfig } from '../index.js'
import { encryptWebPush } from '../drivers/web-push.js'
import { concat, fromBase64Url, toBase64Url, utf8 } from '../drivers/encoding.js'

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dQw4-device-1'

const decode = (text: string): Uint8Array<ArrayBuffer> => {
  const bytes = fromBase64Url(text)
  if (!bytes) throw new Error(`not base64url: ${text}`)
  return bytes
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  )
}

/** A browser with a subscription: its key pair, its auth secret, and the receiving side of RFC 8291 */
async function browser(endpoint = ENDPOINT) {
  const keyPair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const input: WebPushDeviceInput = {
    kind: 'web-push',
    subscription: {
      endpoint,
      expirationTime: null,
      keys: { p256dh: toBase64Url(p256dh), auth: toBase64Url(auth) },
    },
  }

  async function decrypt(body: Uint8Array<ArrayBuffer>): Promise<string> {
    const salt = body.slice(0, 16)
    const recordSize = new DataView(body.buffer, 16, 4).getUint32(0)
    const keyLength = body[20]!
    const serverPublic = body.slice(21, 21 + keyLength)
    const ciphertext = body.slice(21 + keyLength)
    expect(recordSize).toBe(4096)
    expect(keyLength).toBe(65)

    const serverKey = await crypto.subtle.importKey('raw', serverPublic, ECDH, false, [])
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'ECDH', public: serverKey }, keyPair.privateKey, 256),
    )
    const ikm = await hkdf(auth, shared, concat(utf8('WebPush: info\0'), p256dh, serverPublic), 32)
    const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
    const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)
    const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt'])
    const padded = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext),
    )
    expect(padded.at(-1)).toBe(2)
    return new TextDecoder().decode(padded.slice(0, -1))
  }

  return { input, decrypt }
}

interface Sent {
  url: string
  init: RequestInit
  headers: Record<string, string>
  body: Uint8Array<ArrayBuffer>
}

/** A push service in memory: records what it is sent and answers 201 unless told otherwise */
function pushService(answer: () => Response | Promise<Response> = () => created()) {
  const requests: Sent[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      init: init!,
      headers: init!.headers as Record<string, string>,
      body: init!.body as Uint8Array<ArrayBuffer>,
    })
    return answer()
  }
  return { fetch: fetchMock, requests }
}

const created = (): Response => new Response(null, { status: 201 })

const vapid: VapidKeys = await generateVapidKeys()
const subject = 'mailto:ops@example.com'

function driverOn(service: { fetch: typeof fetch }, config: Partial<WebPushDriverConfig> = {}) {
  return createWebPushDriver({ vapid: { ...vapid, subject }, fetch: service.fetch, ...config })
}

const payload: PushPayload = {
  title: 'Kick-off in an hour',
  body: 'Matchday 7',
  url: '/matchday/7',
  tag: 'kick-off',
}

async function verifiedClaims(authorization: string): Promise<Record<string, unknown>> {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization)
  expect(match).not.toBeNull()
  const [, jwt, key] = match!
  expect(key).toBe(vapid.publicKey)
  const [header, claims, signature] = jwt!.split('.')
  const publicKey = await crypto.subtle.importKey('raw', decode(key!), ECDSA, false, ['verify'])
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    decode(signature!),
    utf8(`${header}.${claims}`),
  )
  expect(valid).toBe(true)
  expect(JSON.parse(new TextDecoder().decode(decode(header!)))).toEqual({
    typ: 'JWT',
    alg: 'ES256',
  })
  return JSON.parse(new TextDecoder().decode(decode(claims!))) as Record<string, unknown>
}

describe('Web Push encryption (RFC 8291)', () => {
  it('produces the message of the example in the RFC from its keys and salt', async () => {
    // Section 5 and appendix A of RFC 8291.
    const serverPublic = decode(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    )
    const keyPair: CryptoKeyPair = {
      publicKey: await crypto.subtle.importKey('raw', serverPublic, ECDH, true, []),
      privateKey: await crypto.subtle.importKey(
        'jwk',
        {
          kty: 'EC',
          crv: 'P-256',
          x: toBase64Url(serverPublic.slice(1, 33)),
          y: toBase64Url(serverPublic.slice(33, 65)),
          d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        },
        ECDH,
        true,
        ['deriveBits'],
      ),
    }

    const message = await encryptWebPush(
      utf8('When I grow up, I want to be a watermelon'),
      {
        p256dh: decode(
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        ),
        auth: decode('BTBZMqHH6r4Tts7J_aSIgg'),
      },
      { salt: decode('DGv6ra1nlYgDCS1FRnbzlw'), keyPair },
    )

    expect(toBase64Url(message)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
        'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
        'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })

  it('uses a fresh salt and key pair per message', async () => {
    const { input } = await browser()
    const keys = {
      p256dh: decode(input.subscription.keys.p256dh),
      auth: decode(input.subscription.keys.auth),
    }

    const first = await encryptWebPush(utf8('same'), keys)
    const second = await encryptWebPush(utf8('same'), keys)

    expect(toBase64Url(first)).not.toBe(toBase64Url(second))
    expect(toBase64Url(first.slice(0, 16))).not.toBe(toBase64Url(second.slice(0, 16)))
  })
})

describe('the Web Push driver sending', () => {
  it('posts an encrypted message the browser can read, signed with the VAPID key', async () => {
    const service = pushService()
    const driver = driverOn(service)
    const device = await browser()
    const before = Math.floor(Date.now() / 1000)

    const delivery = await driver.send(await driver.targetOf(device.input), payload)

    expect(delivery).toEqual({ status: 'sent' })
    expect(service.requests).toHaveLength(1)
    const sent = service.requests[0]!
    expect(sent.url).toBe(ENDPOINT)
    expect(sent.init.method).toBe('POST')
    expect(sent.init.redirect).toBe('manual')
    expect(sent.init.signal).toBeInstanceOf(AbortSignal)
    expect(sent.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    })
    expect(sent.headers.Topic).toMatch(/^[A-Za-z0-9_-]{32}$/)

    const claims = await verifiedClaims(sent.headers.Authorization!)
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe(subject)
    expect(claims.exp).toBeGreaterThan(before)
    expect(claims.exp).toBeLessThanOrEqual(before + 24 * 3600)

    // The payload leaves the server encrypted only: no word of it in the body.
    expect(new TextDecoder().decode(sent.body)).not.toContain('Kick-off')
    expect(JSON.parse(await device.decrypt(sent.body))).toEqual(payload)
  })

  it('leaves the ttl out of the message and puts it in the header, the payload before the config', async () => {
    const service = pushService()
    const driver = driverOn(service, { ttl: 600, urgency: 'high' })
    const device = await browser()
    const target = await driver.targetOf(device.input)

    await driver.send(target, { title: 'a', body: 'b' })
    await driver.send(target, { title: 'a', body: 'b', ttl: 0 })

    expect(service.requests[0]!.headers).toMatchObject({ TTL: '600', Urgency: 'high' })
    expect(service.requests[0]!.headers.Topic).toBeUndefined()
    expect(service.requests[1]!.headers.TTL).toBe('0')
    expect(JSON.parse(await device.decrypt(service.requests[1]!.body))).toEqual({
      title: 'a',
      body: 'b',
    })
  })

  it('gives the same tag the same topic and another tag another one', async () => {
    const service = pushService()
    const driver = driverOn(service)
    const target = await driver.targetOf((await browser()).input)

    await driver.send(target, { ...payload, tag: 'kick-off' })
    await driver.send(target, { ...payload, tag: 'kick-off' })
    await driver.send(target, { ...payload, tag: 'result / with spaces and ümlauts' })

    const topics = service.requests.map((request) => request.headers.Topic)
    expect(topics[0]).toBe(topics[1])
    expect(topics[2]).not.toBe(topics[0])
    expect(topics[2]).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('signs one token per push service and reuses it', async () => {
    const service = pushService()
    const driver = driverOn(service, { endpointHosts: 'any' })
    const chrome = await driver.targetOf((await browser()).input)
    const firefox = await driver.targetOf(
      (await browser('https://updates.push.services.mozilla.com/wpush/v2/abc')).input,
    )

    await driver.send(chrome, payload)
    await driver.send(chrome, payload)
    await driver.send(firefox, payload)

    const [first, second, third] = service.requests.map((request) => request.headers.Authorization!)
    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect((await verifiedClaims(third!)).aud).toBe('https://updates.push.services.mozilla.com')
  })

  it.each([404, 410])('answers gone when the push service answers %i', async (status) => {
    const service = pushService(() => new Response('unsubscribed', { status }))
    const driver = driverOn(service)

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect(delivery).toEqual({ status: 'gone', reason: `the push service answered ${status}` })
  })

  it.each([400, 401, 403, 413, 429, 500, 503])(
    'answers failed, with what the service said, when it answers %i',
    async (status) => {
      const service = pushService(() => new Response(' quota exceeded \n', { status }))
      const driver = driverOn(service)

      const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

      expect(delivery).toEqual({
        status: 'failed',
        reason: `the push service answered ${status}: quota exceeded`,
      })
    },
  )

  it('answers failed for a redirect instead of following it', async () => {
    const service = pushService(
      () => new Response(null, { status: 307, headers: { Location: 'https://elsewhere.test/' } }),
    )
    const driver = driverOn(service)

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect(delivery).toEqual({ status: 'failed', reason: 'the push service answered 307' })
  })

  it('answers failed when the service is not reached, without the endpoint in the reason', async () => {
    const driver = driverOn({
      fetch: async (input) => {
        throw new Error(`connect ECONNREFUSED while posting to ${String(input)}`)
      },
    })

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect(delivery.status).toBe('failed')
    const reason = (delivery as { reason: string }).reason
    expect(reason).toContain('the push service was not reached')
    expect(reason).toContain('[endpoint]')
    expect(reason).not.toContain('dQw4-device-1')
  })

  it('keeps the endpoint out of what a push service answered', async () => {
    const service = pushService(
      () => new Response(`no such subscription ${ENDPOINT}`, { status: 400 }),
    )
    const driver = driverOn(service)

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect((delivery as { reason: string }).reason).toBe(
      'the push service answered 400: no such subscription [endpoint]',
    )
  })

  it('refuses a payload a push service would not take, without sending', async () => {
    const service = pushService()
    const driver = driverOn(service)
    const device = await browser()
    const target = await driver.targetOf(device.input)
    const overhead = JSON.stringify({ title: '', body: '' }).length

    const fits = await driver.send(target, {
      title: '',
      body: 'x'.repeat(WEB_PUSH_MAX_PAYLOAD - overhead),
    })
    const tooLarge = await driver.send(target, {
      title: '',
      body: 'x'.repeat(WEB_PUSH_MAX_PAYLOAD - overhead + 1),
    })

    expect(fits).toEqual({ status: 'sent' })
    // 4096 bytes is what a push service takes; the largest payload fills them exactly.
    expect(service.requests[0]!.body).toHaveLength(4096)
    expect(tooLarge).toEqual({
      status: 'failed',
      reason: `the payload is ${WEB_PUSH_MAX_PAYLOAD + 1} bytes, a push service takes ${WEB_PUSH_MAX_PAYLOAD}`,
    })
    expect(service.requests).toHaveLength(1)
  })

  it('answers failed for a stored device that is not a subscription', async () => {
    const service = pushService()
    const driver = driverOn(service)

    const delivery = await driver.send(
      { endpoint: ENDPOINT, keys: { p256dh: 'x', auth: 'y' } },
      payload,
    )

    expect(delivery).toEqual({
      status: 'failed',
      reason: 'the stored device is not a subscription',
    })
    expect(service.requests).toHaveLength(0)
  })

  it('answers failed, and says which keys, when the private key belongs to another pair', async () => {
    const service = pushService()
    const other = await generateVapidKeys()
    const driver = createWebPushDriver({
      vapid: { publicKey: vapid.publicKey, privateKey: other.privateKey, subject },
      fetch: service.fetch,
    })

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect(delivery).toEqual({
      status: 'failed',
      reason:
        'the notification could not be prepared: `vapid.privateKey` is not the private key of `vapid.publicKey`',
    })
    expect(service.requests).toHaveLength(0)
  })
})

describe('the Web Push driver taking a subscription', () => {
  const driver = driverOn(pushService())

  it('stores the endpoint and the two keys, and nothing else', async () => {
    const { input } = await browser()

    const target = await driver.targetOf({ ...input, label: 'ignored' })

    expect(target).toEqual({ endpoint: ENDPOINT, keys: input.subscription.keys })
  })

  it('takes keys in plain base64 and stores them as base64url', async () => {
    const { input } = await browser()
    const base64 = (text: string): string => btoa(String.fromCharCode(...decode(text)))

    const target = await driver.targetOf({
      kind: 'web-push',
      subscription: {
        endpoint: ENDPOINT,
        keys: {
          p256dh: base64(input.subscription.keys.p256dh),
          auth: base64(input.subscription.keys.auth),
        },
      },
    })

    expect(target.keys).toEqual(input.subscription.keys)
  })

  it('identifies a device by its endpoint alone', () => {
    expect(driver.keyOf({ kind: 'web-push', subscription: { endpoint: ENDPOINT } })).toBe(ENDPOINT)
  })

  it.each([
    ['no subscription', { kind: 'web-push' }],
    ['a subscription that is a string', { kind: 'web-push', subscription: ENDPOINT }],
    ['no endpoint', { kind: 'web-push', subscription: { keys: {} } }],
    ['an endpoint that is not a URL', { kind: 'web-push', subscription: { endpoint: 'nope' } }],
    [
      'an endpoint longer than a URL of a push service',
      { kind: 'web-push', subscription: { endpoint: `${ENDPOINT}${'a'.repeat(2048)}` } },
    ],
  ])('refuses %s', async (_name, input) => {
    expect(() => driver.keyOf(input)).toThrow(PushDeviceError)
    await expect(async () => driver.targetOf(input)).rejects.toThrow(PushDeviceError)
  })

  it.each([
    ['http', 'http://fcm.googleapis.com/fcm/send/a'],
    ['credentials in the URL', 'https://user:pass@fcm.googleapis.com/fcm/send/a'],
  ])('refuses an endpoint with %s', async (_name, endpoint) => {
    const { input } = await browser(endpoint)

    await expect(driver.targetOf(input)).rejects.toThrow('has to be an https URL')
  })

  it.each([
    'https://fcm.googleapis.com/fcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/a',
    'https://wns2-par02p.notify.windows.com/w/?token=a',
    'https://web.push.apple.com/a',
  ])('takes the push service at %s', async (endpoint) => {
    const { input } = await browser(endpoint)

    expect((await driver.targetOf(input)).endpoint).toBe(endpoint)
  })

  it.each([
    'https://attacker.test/collect',
    'https://localhost/admin',
    'https://169.254.169.254/latest/meta-data',
    'https://notfcm.googleapis.com/fcm/send/a',
    'https://fcm.googleapis.com.attacker.test/fcm/send/a',
  ])('refuses %s, which is no push service', async (endpoint) => {
    const { input } = await browser(endpoint)

    await expect(driver.targetOf(input)).rejects.toThrow(
      'is not a push service this driver sends to',
    )
  })

  it('names the host and never the rest of the endpoint when it refuses', async () => {
    const { input } = await browser('https://attacker.test/secret-capability')

    const error: unknown = await Promise.resolve()
      .then(() => driver.targetOf(input))
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(PushDeviceError)
    expect((error as Error).message).toContain('"attacker.test"')
    expect((error as Error).message).not.toContain('secret-capability')
  })

  it('takes more hosts, or any https host, when the config says so', async () => {
    const own = driverOn(pushService(), { endpointHosts: [...webPushHosts, 'push.example.com'] })
    const any = driverOn(pushService(), { endpointHosts: 'any' })
    const { input } = await browser('https://eu.push.example.com/send/a')

    expect((await own.targetOf(input)).endpoint).toBe('https://eu.push.example.com/send/a')
    expect((await any.targetOf(input)).endpoint).toBe('https://eu.push.example.com/send/a')
    await expect(driver.targetOf(input)).rejects.toThrow(PushDeviceError)
    const http = await browser('http://eu.push.example.com/send/a')
    await expect(any.targetOf(http.input)).rejects.toThrow('has to be an https URL')
  })

  it.each([
    ['no keys', undefined],
    ['keys that are not strings', { p256dh: 1, auth: 2 }],
    [
      'a p256dh of the wrong length',
      { p256dh: toBase64Url(new Uint8Array(64)), auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
    ],
    [
      'an auth secret of the wrong length',
      { p256dh: 'valid', auth: toBase64Url(new Uint8Array(8)) },
    ],
    ['keys that are not base64', { p256dh: '***', auth: '***' }],
  ])('refuses %s', async (_name, keys) => {
    const { input } = await browser()
    const valid = input.subscription.keys
    const broken = keys && keys.p256dh === 'valid' ? { ...keys, p256dh: valid.p256dh } : keys

    await expect(
      driver.targetOf({ kind: 'web-push', subscription: { endpoint: ENDPOINT, keys: broken } }),
    ).rejects.toThrow('`subscription.keys` needs')
  })

  it('refuses a key of the right length that is not on the curve', async () => {
    const { input } = await browser()
    const offCurve = new Uint8Array(65).fill(7)
    offCurve[0] = 4

    await expect(
      driver.targetOf({
        kind: 'web-push',
        subscription: {
          endpoint: ENDPOINT,
          keys: { p256dh: toBase64Url(offCurve), auth: input.subscription.keys.auth },
        },
      }),
    ).rejects.toThrow('is not a point on P-256')
  })
})

describe('the Web Push driver config', () => {
  const valid = { ...vapid, subject }

  it('makes a key pair the driver takes', async () => {
    const keys = await generateVapidKeys()

    expect(decode(keys.publicKey)).toHaveLength(65)
    expect(decode(keys.publicKey)[0]).toBe(4)
    expect(decode(keys.privateKey)).toHaveLength(32)
    expect(createWebPushDriver({ vapid: { ...keys, subject } }).kind).toBe('web-push')
    expect((await generateVapidKeys()).privateKey).not.toBe(keys.privateKey)
  })

  it.each([
    ['a public key that is none', { ...valid, publicKey: 'short' }, '`vapid.publicKey`'],
    ['a private key that is none', { ...valid, privateKey: vapid.publicKey }, '`vapid.privateKey`'],
    ['keys that were swapped', { ...valid, publicKey: vapid.privateKey }, '`vapid.publicKey`'],
    ['no subject', { ...valid, subject: '' }, '`vapid.subject`'],
    [
      'a subject that is a bare address',
      { ...valid, subject: 'ops@example.com' },
      '`vapid.subject`',
    ],
    ['a subject over http', { ...valid, subject: 'http://example.com' }, '`vapid.subject`'],
  ])('refuses %s', (_name, keys, message) => {
    expect(() => createWebPushDriver({ vapid: keys })).toThrow(NotificationsError)
    expect(() => createWebPushDriver({ vapid: keys })).toThrow(message)
  })

  it('takes an https subject', () => {
    expect(() =>
      createWebPushDriver({ vapid: { ...vapid, subject: 'https://example.com/contact' } }),
    ).not.toThrow()
  })

  it.each([-1, 1.5, Number.NaN])('refuses a ttl of %s', async (ttl) => {
    expect(() => createWebPushDriver({ vapid: valid, ttl })).toThrow('whole number of seconds')

    const service = pushService()
    const driver = driverOn(service)
    const delivery = await driver.send(await driver.targetOf((await browser()).input), {
      ...payload,
      ttl,
    })
    expect(delivery.status).toBe('failed')
    expect(service.requests).toHaveLength(0)
  })

  it('refuses an unknown urgency', () => {
    expect(() => createWebPushDriver({ vapid: valid, urgency: 'asap' as never })).toThrow(
      'unknown urgency "asap"',
    )
  })
})

describe('Web Push through notify', () => {
  it('reaches every browser of a user and drops the one its push service gave up', async () => {
    const gone = 'https://updates.push.services.mozilla.com/wpush/v2/gone'
    const requests: string[] = []
    const driver = createWebPushDriver({
      vapid: { ...vapid, subject },
      fetch: async (input) => {
        requests.push(String(input))
        return new Response(null, { status: String(input) === gone ? 410 : 201 })
      },
    })
    const notifications = createNotifications({
      channels: { push: { store: createMemoryDeviceStore(), drivers: [driver] } },
    })
    const chrome = await browser()
    const firefox = await browser(gone)
    const kept = await notifications.devices.register('u1', chrome.input)
    const dropped = await notifications.devices.register('u1', firefox.input)

    const report = await notifications.notify(
      { id: 'u1' },
      { channels: () => ['push'], toPush: () => payload },
    )

    expect([...requests].sort()).toEqual([ENDPOINT, gone].sort())
    expect(report.ok).toBe(true)
    expect(report.channels[0]!.devices).toEqual([
      { deviceId: kept.id, kind: 'web-push', status: 'sent' },
      {
        deviceId: dropped.id,
        kind: 'web-push',
        status: 'gone',
        reason: 'the push service answered 410',
      },
    ])
    expect(await notifications.devices.list('u1')).toEqual([kept])
  })

  it('removes a browser by its endpoint, as a page that unsubscribes knows it', async () => {
    const notifications = createNotifications({
      channels: {
        push: { store: createMemoryDeviceStore(), drivers: [driverOn(pushService())] },
      },
    })
    const { input } = await browser()
    await notifications.devices.register('u1', input)

    const removed = await notifications.devices.unregister('u1', {
      kind: 'web-push',
      subscription: { endpoint: ENDPOINT },
    })

    expect(removed).toBe(true)
    expect(await notifications.devices.list('u1')).toEqual([])
  })

  it('refuses to register what is not a subscription, and stores nothing', async () => {
    const notifications = createNotifications({
      channels: {
        push: { store: createMemoryDeviceStore(), drivers: [driverOn(pushService())] },
      },
    })

    await expect(
      notifications.devices.register('u1', {
        kind: 'web-push',
        subscription: { endpoint: 'https://attacker.test/x', keys: {} },
      }),
    ).rejects.toThrow(PushDeviceError)
    expect(await notifications.devices.list('u1')).toEqual([])
  })
})

describe('the Web Push driver and what it was not handed at registration', () => {
  it('does not post to a stored endpoint that is no push service', async () => {
    const service = pushService()
    const driver = driverOn(service)
    const { input } = await browser()

    for (const endpoint of [
      'https://attacker.test/collect',
      'http://fcm.googleapis.com/fcm/send/a',
    ]) {
      const delivery = await driver.send({ endpoint, keys: input.subscription.keys }, payload)

      expect(delivery).toEqual({
        status: 'failed',
        reason: 'the stored endpoint is not a push service this driver sends to',
      })
    }
    expect(service.requests).toHaveLength(0)
  })

  it('reads no more than the start of what a push service answered', async () => {
    const service = pushService(() => new Response('x'.repeat(5000), { status: 500 }))
    const driver = driverOn(service)

    const delivery = await driver.send(await driver.targetOf((await browser()).input), payload)

    expect((delivery as { reason: string }).reason).toBe(
      `the push service answered 500: ${'x'.repeat(200)}`,
    )
  })
})
