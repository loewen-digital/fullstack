import { afterEach, describe, it, expect, vi } from 'vite-plus/test'
import {
  APNS_MAX_PAYLOAD,
  NotificationsError,
  PushDeviceError,
  createApnsDriver,
  createMemoryDeviceStore,
  createNotifications,
} from '../index.js'
import type {
  ApnsDeviceInput,
  ApnsDriverConfig,
  ApnsTarget,
  Notification,
  PushPayload,
} from '../index.js'
import { fromBase64Url, sha256, toBase64Url, utf8 } from '../drivers/encoding.js'

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const TEAM_ID = 'ABCDE12345'
const KEY_ID = 'FGHIJ67890'
const BUNDLE_ID = 'com.example.app'
const IPHONE = 'a1'.repeat(32)
const IPAD = 'b2'.repeat(32)
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0)

/**
 * A signing key the way Apple hands one out: a `.p8` file is PKCS #8 in PEM. Made for the run
 * and never stored, so no key is in the repository.
 */
async function signingKey() {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const lines = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  return {
    p8: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`,
    publicKey: pair.publicKey,
  }
}

const key = await signingKey()
const sandboxKey = await signingKey()

interface Sent {
  url: string
  init: RequestInit
  headers: Record<string, string>
  body: Record<string, unknown>
  bytes: number
}

// Apple's answers. The 403 is what Apple's sandbox answered this driver on 2026-11-17 for a
// key Apple does not know; the others are the samples in Apple's "Handling notification
// responses from APNs".
const delivered = (): Response =>
  new Response(null, {
    status: 200,
    headers: { 'apns-id': 'eabeae54-14a8-11e5-b60b-1697f925ec7b' },
  })
const refused = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'apns-id': 'E9D8F29F-B504-630E-8997-FCBE1AB1C9AD' },
  })
const unknownKey = (): Response => refused(403, { reason: 'InvalidProviderToken' })
const unregistered = (): Response =>
  refused(410, { reason: 'Unregistered', timestamp: 1_794_000_000_000 })

/** Apple in memory: records what it is sent and answers 200 unless told otherwise */
function apple(answer: (request: Sent) => Response | Promise<Response> = () => delivered()) {
  const requests: Sent[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    const bytes = init!.body as Uint8Array<ArrayBuffer>
    const request: Sent = {
      url: String(input),
      init: init!,
      headers: init!.headers as Record<string, string>,
      body: JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>,
      bytes: bytes.length,
    }
    requests.push(request)
    return answer(request)
  }
  return { fetch: fetchMock, requests }
}

function driverOn(service: { fetch: typeof fetch }, config: Partial<ApnsDriverConfig> = {}) {
  return createApnsDriver({
    teamId: TEAM_ID,
    keyId: KEY_ID,
    privateKey: key.p8,
    bundleId: BUNDLE_ID,
    fetch: service.fetch,
    ...config,
  })
}

const device = (
  token: string,
  environment: ApnsDeviceInput['environment'] = 'production',
): ApnsDeviceInput => ({ kind: 'apns', token, environment })

const target = (
  token: string,
  environment: ApnsTarget['environment'] = 'production',
): ApnsTarget => ({ token, environment })

const payload: PushPayload = {
  title: 'Kick-off in an hour',
  body: 'Matchday 7',
  url: '/matchday/7',
  tag: 'kick-off',
}

const kickOff: Notification = { channels: () => ['push'], toPush: () => payload }

function notificationsOn(service: { fetch: typeof fetch }, config: Partial<ApnsDriverConfig> = {}) {
  return createNotifications({
    channels: { push: { store: createMemoryDeviceStore(), drivers: [driverOn(service, config)] } },
  })
}

const decode = (text: string): Uint8Array<ArrayBuffer> => {
  const bytes = fromBase64Url(text)
  if (!bytes) throw new Error(`not base64url: ${text}`)
  return bytes
}

/** Checks the provider token as Apple does, with the public half of the key, and returns its two parts */
async function verifiedToken(authorization: string, publicKey = key.publicKey) {
  const match = /^bearer ([^.]+)\.([^.]+)\.([^.]+)$/.exec(authorization)
  expect(match).not.toBeNull()
  const [, header, claims, signature] = match!
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    decode(signature!),
    utf8(`${header}.${claims}`),
  )
  expect(valid).toBe(true)
  return {
    header: JSON.parse(new TextDecoder().decode(decode(header!))) as Record<string, unknown>,
    claims: JSON.parse(new TextDecoder().decode(decode(claims!))) as Record<string, unknown>,
  }
}

function atNoon() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('registering an iPhone or iPad', () => {
  it('stores the token in lower case with its environment', async () => {
    const notifications = notificationsOn(apple())
    const registered = await notifications.devices.register(
      'u1',
      device(IPHONE.toUpperCase(), 'sandbox'),
    )

    expect(registered.kind).toBe('apns')
    expect(registered.target).toEqual({ token: IPHONE, environment: 'sandbox' })
    expect(await notifications.devices.list('u1')).toHaveLength(1)
  })

  it('keeps one entry for a token that registers again, in any case', async () => {
    const notifications = notificationsOn(apple())
    const first = await notifications.devices.register('u1', device(IPHONE))
    const second = await notifications.devices.register('u1', device(IPHONE.toUpperCase()))

    expect(second.id).toBe(first.id)
    expect(await notifications.devices.list('u1')).toHaveLength(1)
  })

  it('unregisters by what the app registered', async () => {
    const notifications = notificationsOn(apple())
    await notifications.devices.register('u1', device(IPHONE))
    await notifications.devices.register('u1', device(IPAD))

    expect(await notifications.devices.unregister('u1', device(IPHONE))).toBe(true)
    const left = await notifications.devices.list('u1')
    expect(left.map((entry) => entry.target)).toEqual([{ token: IPAD, environment: 'production' }])
  })

  it.each([
    ['the description of the token data', `<${IPHONE.slice(0, 8)} ${IPHONE.slice(8, 16)}>`],
    ['base64', 'oaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaGhoaE='],
    ['an odd number of digits', IPHONE.slice(1)],
    ['a path', `${IPHONE}/../../3/device/${IPAD}`],
    ['nothing', ''],
    ['more than Apple could issue', 'ab'.repeat(257)],
  ])('refuses %s as a token', async (_name, token) => {
    const notifications = notificationsOn(apple())
    const attempt = notifications.devices.register('u1', device(token))

    await expect(attempt).rejects.toBeInstanceOf(PushDeviceError)
    await expect(attempt).rejects.toThrow('hexadecimal digits')
    expect(await notifications.devices.list('u1')).toEqual([])
  })

  it('refuses a device without a known environment', async () => {
    const notifications = notificationsOn(apple())
    for (const environment of [undefined, 'development', 'PRODUCTION', 1]) {
      const attempt = notifications.devices.register('u1', {
        kind: 'apns',
        token: IPHONE,
        environment,
      })
      await expect(attempt).rejects.toBeInstanceOf(PushDeviceError)
      await expect(attempt).rejects.toThrow("'production' or 'sandbox'")
    }
  })

  it('names no token in what it refuses', async () => {
    const notifications = notificationsOn(apple())
    const error: unknown = await notifications.devices
      .register('u1', device(`${IPHONE}zz`))
      .catch((caught: unknown) => caught)

    expect(String(error)).not.toContain(IPHONE)
  })
})

describe('what Apple is sent', () => {
  it('posts to the service of the device, with the token as the path', async () => {
    const service = apple()
    const driver = driverOn(service)

    expect(await driver.send(target(IPHONE), payload)).toEqual({ status: 'sent' })
    expect(await driver.send(target(IPAD, 'sandbox'), payload)).toEqual({ status: 'sent' })

    expect(service.requests.map((request) => request.url)).toEqual([
      `https://api.push.apple.com/3/device/${IPHONE}`,
      `https://api.sandbox.push.apple.com/3/device/${IPAD}`,
    ])
    const { init } = service.requests[0]!
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('names the app as the topic and signs with the key of the team', async () => {
    atNoon()
    const service = apple()
    await driverOn(service).send(target(IPHONE), payload)

    const { headers } = service.requests[0]!
    expect(headers['apns-topic']).toBe(BUNDLE_ID)
    expect(headers['apns-push-type']).toBe('alert')
    expect(headers['content-type']).toBe('application/json')

    const token = await verifiedToken(headers.authorization!)
    expect(token.header).toEqual({ alg: 'ES256', kid: KEY_ID })
    expect(token.claims).toEqual({ iss: TEAM_ID, iat: NOW / 1000 })
  })

  it('carries the title, the body, the link and the tag', async () => {
    const service = apple()
    await driverOn(service).send(target(IPHONE), {
      ...payload,
      icon: '/icon.png',
      data: { matchday: 7 },
    })

    expect(service.requests[0]!.body).toEqual({
      aps: { alert: { title: 'Kick-off in an hour', body: 'Matchday 7' }, sound: 'default' },
      url: '/matchday/7',
      tag: 'kick-off',
      data: { matchday: 7 },
    })
  })

  it('plays the sound the config names, or none', async () => {
    const service = apple()
    await driverOn(service, { sound: 'whistle.caf' }).send(target(IPHONE), payload)
    await driverOn(service, { sound: false }).send(target(IPHONE), payload)

    expect(service.requests[0]!.body.aps).toMatchObject({ sound: 'whistle.caf' })
    expect(service.requests[1]!.body.aps).toEqual({
      alert: { title: 'Kick-off in an hour', body: 'Matchday 7' },
    })
  })

  it('tells Apple how long to keep a notification for a device that is offline', async () => {
    atNoon()
    const service = apple()
    const seconds = NOW / 1000

    await driverOn(service).send(target(IPHONE), payload)
    await driverOn(service, { ttl: 600 }).send(target(IPHONE), payload)
    await driverOn(service, { ttl: 600 }).send(target(IPHONE), { ...payload, ttl: 60 })
    await driverOn(service).send(target(IPHONE), { ...payload, ttl: 0 })

    expect(service.requests.map((request) => request.headers['apns-expiration'])).toEqual([
      String(seconds + 86_400),
      String(seconds + 600),
      String(seconds + 60),
      '0',
    ])
  })

  it('makes the tag the collapse id, as it is or as its hash', async () => {
    const service = apple()
    const driver = driverOn(service)
    const long = 'k'.repeat(65)

    await driver.send(target(IPHONE), payload)
    await driver.send(target(IPHONE), { ...payload, tag: 'Anstoß heute' })
    await driver.send(target(IPHONE), { ...payload, tag: long })
    await driver.send(target(IPHONE), { title: 'Hello', body: 'World' })

    const ids = service.requests.map((request) => request.headers['apns-collapse-id'])
    expect(ids).toEqual([
      'kick-off',
      toBase64Url(await sha256(utf8('Anstoß heute'))),
      toBase64Url(await sha256(utf8(long))),
      undefined,
    ])
    for (const id of ids.slice(0, 3)) expect(utf8(id!).length).toBeLessThanOrEqual(64)
  })

  it('reads a key whose line breaks arrived as backslash and n', async () => {
    const service = apple()
    const driver = driverOn(service, { privateKey: key.p8.replace(/\n/g, '\\n') })

    expect(await driver.send(target(IPHONE), payload)).toEqual({ status: 'sent' })
    await verifiedToken(service.requests[0]!.headers.authorization!)
  })
})

describe('the provider token', () => {
  it('is signed once and reused, also by notifications that go out together', async () => {
    const service = apple()
    const notifications = notificationsOn(service)
    await notifications.devices.register('u1', device(IPHONE))
    await notifications.devices.register('u1', device(IPAD))

    await notifications.notify({ id: 'u1' }, kickOff)
    await notifications.notify({ id: 'u1' }, kickOff)

    expect(service.requests).toHaveLength(4)
    expect(new Set(service.requests.map((request) => request.headers.authorization)).size).toBe(1)
  })

  it('is kept for 45 minutes and then signed anew, within the hour Apple takes one', async () => {
    atNoon()
    const service = apple()
    const driver = driverOn(service)

    await driver.send(target(IPHONE), payload)
    vi.setSystemTime(NOW + 44 * 60_000)
    await driver.send(target(IPHONE), payload)
    vi.setSystemTime(NOW + 45 * 60_000)
    await driver.send(target(IPHONE), payload)

    const [first, second, third] = service.requests.map((request) => request.headers.authorization!)
    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect((await verifiedToken(third!)).claims.iat).toBe(NOW / 1000 + 45 * 60)
  })

  it('is signed anew after Apple called it expired', async () => {
    const service = apple(() =>
      service.requests.length === 1
        ? refused(403, { reason: 'ExpiredProviderToken' })
        : delivered(),
    )
    const driver = driverOn(service)

    expect(await driver.send(target(IPHONE), payload)).toEqual({
      status: 'failed',
      reason: 'Apple answered 403 ExpiredProviderToken',
    })
    expect(await driver.send(target(IPHONE), payload)).toEqual({ status: 'sent' })
    expect(service.requests[1]!.headers.authorization).not.toBe(
      service.requests[0]!.headers.authorization,
    )
  })

  it("comes from the sandbox's own key for a sandbox device when there is one", async () => {
    const service = apple()
    const driver = driverOn(service, {
      sandbox: { keyId: 'SANDBOX123', privateKey: sandboxKey.p8 },
    })

    await driver.send(target(IPHONE), payload)
    await driver.send(target(IPAD, 'sandbox'), payload)

    const production = await verifiedToken(service.requests[0]!.headers.authorization!)
    const sandbox = await verifiedToken(
      service.requests[1]!.headers.authorization!,
      sandboxKey.publicKey,
    )
    expect(production.header.kid).toBe(KEY_ID)
    expect(sandbox.header.kid).toBe('SANDBOX123')
    expect(sandbox.claims.iss).toBe(TEAM_ID)
  })
})

describe('what Apple answers', () => {
  it('removes a device Apple reports as unregistered and sends to the others', async () => {
    const service = apple((request) =>
      request.url.endsWith(IPHONE) ? unregistered() : delivered(),
    )
    const notifications = notificationsOn(service)
    const iphone = await notifications.devices.register('u1', device(IPHONE))
    const ipad = await notifications.devices.register('u1', device(IPAD))

    const report = await notifications.notify({ id: 'u1' }, kickOff)

    expect(report.ok).toBe(true)
    expect(report.channels[0]!.devices).toEqual([
      {
        deviceId: iphone.id,
        kind: 'apns',
        status: 'gone',
        reason: 'Apple answered 410 Unregistered',
      },
      { deviceId: ipad.id, kind: 'apns', status: 'sent' },
    ])
    expect((await notifications.devices.list('u1')).map((entry) => entry.id)).toEqual([ipad.id])
  })

  it.each([
    [400, 'BadDeviceToken'],
    [410, 'ExpiredToken'],
  ])('takes %i %s as a token that is gone', async (status, reason) => {
    const driver = driverOn(apple(() => refused(status, { reason })))

    expect(await driver.send(target(IPHONE), payload)).toEqual({
      status: 'gone',
      reason: `Apple answered ${status} ${reason}`,
    })
  })

  it("names Apple's reason for a notification it refused, and keeps the device", async () => {
    const notifications = notificationsOn(apple(() => unknownKey()))
    const iphone = await notifications.devices.register('u1', device(IPHONE))

    const report = await notifications.notify({ id: 'u1' }, kickOff)

    expect(report.ok).toBe(false)
    expect(report.channels[0]!.devices).toEqual([
      {
        deviceId: iphone.id,
        kind: 'apns',
        status: 'failed',
        reason: 'Apple answered 403 InvalidProviderToken',
      },
    ])
    expect(await notifications.devices.list('u1')).toHaveLength(1)
  })

  it.each([
    [400, 'DeviceTokenNotForTopic'],
    [400, 'BadTopic'],
    [403, 'BadEnvironmentKeyIdInToken'],
    [429, 'TooManyProviderTokenUpdates'],
    [503, 'ServiceUnavailable'],
  ])('keeps the device on %i %s', async (status, reason) => {
    const driver = driverOn(apple(() => refused(status, { reason })))

    expect(await driver.send(target(IPHONE), payload)).toEqual({
      status: 'failed',
      reason: `Apple answered ${status} ${reason}`,
    })
  })

  it('passes on the status alone when the answer is not one of Apple', async () => {
    const answers = [
      new Response('<html>Bad Gateway</html>', { status: 502 }),
      new Response(JSON.stringify({ reason: `<script>${IPHONE}</script>` }), { status: 400 }),
      new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
      new Response(null, { status: 204 }),
    ]
    const driver = driverOn(apple(() => answers.shift()!))

    for (const status of [502, 400, 302, 204]) {
      expect(await driver.send(target(IPHONE), payload)).toEqual({
        status: 'failed',
        reason: `Apple answered ${status}`,
      })
    }
  })

  it('reports an outage without the token', async () => {
    const service = {
      fetch: (async (input) => {
        throw new TypeError(`request to ${String(input)} timed out`)
      }) as typeof fetch,
    }
    const delivery = await driverOn(service).send(target(IPHONE), payload)

    expect(delivery).toEqual({
      status: 'failed',
      reason:
        'Apple was not reached: request to https://api.push.apple.com/3/device/[token] timed out',
    })
  })

  it('says so when the fetch of the runtime speaks no HTTP/2', async () => {
    // What `fetch` of Node 24 throws for Apple's hosts, recorded on 2026-11-17.
    const service = {
      fetch: (async () => {
        throw new TypeError('fetch failed', {
          cause: new Error(
            'Response does not match the HTTP/1.1 protocol (Expected HTTP/, RTSP/ or ICE/)',
          ),
        })
      }) as typeof fetch,
    }
    const delivery = await driverOn(service).send(target(IPHONE), payload)

    expect(delivery.status).toBe('failed')
    expect(delivery).toMatchObject({ reason: expect.stringContaining('speaks HTTP/2 only') })
  })

  it('does not send a payload Apple would refuse for its size', async () => {
    const service = apple()
    const driver = driverOn(service)
    const fits = await driver.send(target(IPHONE), { title: 'Hello', body: 'x'.repeat(3900) })
    const tooLarge = await driver.send(target(IPHONE), { title: 'Hello', body: 'x'.repeat(4100) })

    expect(fits).toEqual({ status: 'sent' })
    expect(service.requests).toHaveLength(1)
    expect(service.requests[0]!.bytes).toBeLessThanOrEqual(APNS_MAX_PAYLOAD)
    expect(tooLarge.status).toBe('failed')
    expect(tooLarge).toMatchObject({ reason: expect.stringContaining('Apple takes 4096') })
  })

  it('does not send to a stored device that is not a token of an environment', async () => {
    const service = apple()
    const driver = driverOn(service)
    const stored = [
      { token: `${IPHONE}/../x`, environment: 'production' },
      { token: IPHONE, environment: 'api.example.com' },
      { endpoint: 'https://example.com/' },
      null,
    ] as unknown as ApnsTarget[]

    for (const entry of stored) {
      const delivery = await driver.send(entry, payload)
      expect(delivery).toMatchObject({ status: 'failed' })
      expect(JSON.stringify(delivery)).not.toContain(IPHONE)
    }
    expect(service.requests).toEqual([])
  })
})

describe('the config of the APNs driver', () => {
  const config: ApnsDriverConfig = {
    teamId: TEAM_ID,
    keyId: KEY_ID,
    privateKey: key.p8,
    bundleId: BUNDLE_ID,
  }

  it('is checked when the driver is created', () => {
    const wrong: [Partial<ApnsDriverConfig>, string][] = [
      [{ teamId: '' }, '`teamId`'],
      [{ keyId: 'has spaces' }, '`keyId`'],
      [{ bundleId: '' }, '`bundleId`'],
      [{ bundleId: 'com.example.app\r\nx: y' }, '`bundleId`'],
      [{ privateKey: '' }, '`privateKey`'],
      [
        { privateKey: '-----BEGIN PRIVATE KEY-----\n!!\n-----END PRIVATE KEY-----' },
        '`privateKey`',
      ],
      [{ sandbox: { keyId: '', privateKey: key.p8 } }, '`sandbox.keyId`'],
      [{ sandbox: { keyId: KEY_ID, privateKey: '' } }, '`sandbox.privateKey`'],
      [{ ttl: -1 }, '`ttl`'],
      [{ ttl: 1.5 }, '`ttl`'],
      [{ sound: '' }, '`sound`'],
    ]
    for (const [part, name] of wrong) {
      const create = () => createApnsDriver({ ...config, ...part })
      expect(create).toThrow(NotificationsError)
      expect(create).toThrow(name)
    }
    expect(createApnsDriver(config).kind).toBe('apns')
  })

  it('reports a key that is no signing key on the first send, without the key', async () => {
    const notAKey = btoa('not a key at all, only base64 of some text')
    const service = apple()
    const driver = driverOn(service, {
      privateKey: notAKey,
      sandbox: { keyId: 'SANDBOX123', privateKey: notAKey },
    })

    const production = await driver.send(target(IPHONE), payload)
    const sandbox = await driver.send(target(IPHONE, 'sandbox'), payload)

    expect(production).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('`privateKey` is not a signing key'),
    })
    expect(sandbox).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('`sandbox.privateKey` is not a signing key'),
    })
    expect(JSON.stringify([production, sandbox])).not.toContain(notAKey)
    expect(service.requests).toEqual([])
  })

  it('refuses a ttl on a payload that is no number of seconds', async () => {
    const service = apple()
    const delivery = await driverOn(service).send(target(IPHONE), { ...payload, ttl: -5 })

    expect(delivery).toMatchObject({ status: 'failed', reason: expect.stringContaining('`ttl`') })
    expect(service.requests).toEqual([])
  })
})
