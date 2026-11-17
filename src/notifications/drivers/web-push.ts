/**
 * Web Push: notifications for browsers and installed web apps, through the push service the
 * browser subscribed at. The payload is encrypted for the browser (RFC 8291, `aes128gcm`) and the
 * request is signed with the app's VAPID key (RFC 8292). Web Crypto and `fetch` only: no
 * dependency, and the same code on Node and on Cloudflare Workers.
 */
import { NotificationsError, PushDeviceError } from '../errors.js'
import type { PushDelivery, PushDeviceInput, PushDriver, PushPayload } from '../types.js'
import { concat, fromBase64Url, sha256, signEs256Jwt, toBase64Url, utf8 } from './encoding.js'

/** A browser's push subscription, as `PushSubscription.toJSON()` returns it */
export interface WebPushSubscription {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/** What an app hands to `devices.register()` for a browser */
export interface WebPushDeviceInput extends PushDeviceInput {
  kind: 'web-push'
  subscription: WebPushSubscription
}

/** What the register stores for a browser: the endpoint and the two keys, base64url */
export type WebPushTarget = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface VapidKeys {
  /** base64url of the 65 bytes of the P-256 point; the page subscribes with it */
  publicKey: string
  /** base64url of the 32 bytes of the private scalar (the `d` of the JWK). A secret */
  privateKey: string
}

export type WebPushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface WebPushDriverConfig {
  /**
   * The key pair of the app, from `generateVapidKeys()`, and `subject`: a `mailto:` address or
   * an `https:` URL under which a push service reaches the sender. The private key is a secret:
   * read it from the environment.
   */
  vapid: VapidKeys & { subject: string }
  /**
   * Seconds a push service keeps a notification for a browser that is offline (default: 86400,
   * a day). `ttl` on a payload wins.
   */
  ttl?: number
  /** How soon a push service wakes a device that saves power (default: `'normal'`) */
  urgency?: WebPushUrgency
  /**
   * The hosts an endpoint may have: each entry allows itself and its subdomains. Default:
   * `webPushHosts`, the push services of Chrome, Firefox, Edge and Safari. `'any'` takes every
   * https host, which lets a signed-in user make the server post to a host of their choice.
   */
  endpointHosts?: readonly string[] | 'any'
  /** Milliseconds to wait for a push service (default: 10000) */
  timeoutMs?: number
  /** Replaces the global `fetch`, for tests */
  fetch?: typeof fetch
}

/**
 * The push services browsers subscribe at: Google's (Chrome and every Chromium browser but
 * Edge on Windows), Mozilla's, Microsoft's and Apple's. An entry covers its subdomains.
 */
export const webPushHosts: readonly string[] = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'jmt17.google.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
]

const DEFAULT_TTL = 86_400
const DEFAULT_TIMEOUT_MS = 10_000
const RECORD_SIZE = 4096
/** What fits one record a push service takes: 4096 less the header (86), the tag (16) and the delimiter (1) */
export const WEB_PUSH_MAX_PAYLOAD = RECORD_SIZE - 86 - 16 - 1
/** A VAPID token is signed for twelve hours (RFC 8292 allows 24) and replaced an hour before it ends */
const TOKEN_SECONDS = 12 * 3600
const TOKEN_REFRESH_SECONDS = 3600
const MAX_ENDPOINT_LENGTH = 2048
const URGENCIES: readonly string[] = ['very-low', 'low', 'normal', 'high']

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const

/**
 * A key pair for `vapid`. Make it once and keep it: a browser's subscription is bound to the
 * public key it was made with, so a new pair orphans every registered device.
 */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  if (typeof jwk.d !== 'string') throw new NotificationsError('web-push: no private key generated')
  return {
    publicKey: toBase64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: jwk.d,
  }
}

/**
 * Create the Web Push driver.
 *
 * Usage:
 *   const notifications = createNotifications({
 *     channels: {
 *       push: {
 *         store: createMemoryDeviceStore(),
 *         drivers: [createWebPushDriver({ vapid: { publicKey, privateKey, subject: 'mailto:ops@example.com' } })],
 *       },
 *     },
 *   })
 *   await notifications.devices.register(userId, { kind: 'web-push', subscription })
 */
export function createWebPushDriver(config: WebPushDriverConfig): PushDriver<WebPushTarget> {
  const publicBytes = fromBase64Url(String(config.vapid?.publicKey ?? ''))
  const privateBytes = fromBase64Url(String(config.vapid?.privateKey ?? ''))
  if (!publicBytes || publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new NotificationsError(
      'web-push: `vapid.publicKey` is not a P-256 public key (65 bytes, base64url). generateVapidKeys() makes a pair.',
    )
  }
  if (!privateBytes || privateBytes.length !== 32) {
    throw new NotificationsError(
      'web-push: `vapid.privateKey` is not a P-256 private key (32 bytes, base64url). generateVapidKeys() makes a pair.',
    )
  }
  const subject = config.vapid.subject
  if (typeof subject !== 'string' || !/^(mailto:.+@.+|https:\/\/.+)/.test(subject)) {
    throw new NotificationsError(
      'web-push: `vapid.subject` has to be a `mailto:` address or an `https:` URL; a push service contacts the sender there.',
    )
  }
  const defaultTtl = checkedTtl(config.ttl ?? DEFAULT_TTL, '`ttl`')
  const urgency = config.urgency ?? 'normal'
  if (!URGENCIES.includes(urgency)) {
    throw new NotificationsError(`web-push: unknown urgency "${String(urgency)}"`)
  }
  const hosts = config.endpointHosts ?? webPushHosts
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const publicKey = toBase64Url(publicBytes)

  let signingKey: Promise<CryptoKey> | undefined
  const importSigningKey = (): Promise<CryptoKey> =>
    (signingKey ??= crypto.subtle
      .importKey(
        'jwk',
        {
          kty: 'EC',
          crv: 'P-256',
          x: toBase64Url(publicBytes.slice(1, 33)),
          y: toBase64Url(publicBytes.slice(33, 65)),
          d: toBase64Url(privateBytes),
        },
        ECDSA,
        false,
        ['sign'],
      )
      .catch(() => {
        // Both have the right length, so what is left is two halves of different pairs.
        throw new NotificationsError(
          '`vapid.privateKey` is not the private key of `vapid.publicKey`',
        )
      }))

  // One token per push service, reused until shortly before it ends, instead of a signature
  // per notification.
  const tokens = new Map<string, { value: string; refreshAt: number }>()
  async function authorization(audience: string): Promise<string> {
    const now = Date.now()
    const cached = tokens.get(audience)
    if (cached && cached.refreshAt > now) return cached.value
    const jwt = await signEs256Jwt(
      await importSigningKey(),
      { typ: 'JWT', alg: 'ES256' },
      { aud: audience, exp: Math.floor(now / 1000) + TOKEN_SECONDS, sub: subject },
    )
    const value = `vapid t=${jwt}, k=${publicKey}`
    if (tokens.size >= 100) tokens.clear()
    tokens.set(audience, {
      value,
      refreshAt: now + (TOKEN_SECONDS - TOKEN_REFRESH_SECONDS) * 1000,
    })
    return value
  }

  function hostAllowed(hostname: string): boolean {
    if (hosts === 'any') return true
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  }

  return {
    kind: 'web-push',

    keyOf(input) {
      return endpointOf(input).href
    },

    async targetOf(input) {
      const url = endpointOf(input)
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new PushDeviceError('web-push: the endpoint of a subscription has to be an https URL')
      }
      if (!hostAllowed(url.hostname)) {
        throw new PushDeviceError(
          `web-push: "${url.hostname}" is not a push service this driver sends to. Add it to \`endpointHosts\` if it is one.`,
        )
      }
      const keys = keysOf((input.subscription as Record<string, unknown>).keys)
      if (!keys) {
        throw new PushDeviceError(
          'web-push: `subscription.keys` needs `p256dh` (65 bytes) and `auth` (16 bytes), base64url, as PushSubscription.toJSON() returns them',
        )
      }
      try {
        await crypto.subtle.importKey('raw', keys.p256dh, ECDH, false, [])
      } catch {
        throw new PushDeviceError('web-push: `subscription.keys.p256dh` is not a point on P-256')
      }
      return {
        endpoint: url.href,
        keys: { p256dh: toBase64Url(keys.p256dh), auth: toBase64Url(keys.auth) },
      }
    },

    async send(target, payload): Promise<PushDelivery> {
      const endpoint = typeof target?.endpoint === 'string' ? target.endpoint : ''
      // Whatever goes into a reason is read by people and logs: never the endpoint.
      const scrub = (text: string): string =>
        endpoint === '' ? text : text.split(endpoint).join('[endpoint]')
      const failed = (reason: string): PushDelivery => ({ status: 'failed', reason: scrub(reason) })

      let request: { url: URL; init: RequestInit }
      try {
        const keys = keysOf(target?.keys)
        if (endpoint === '' || !keys) return failed('the stored device is not a subscription')
        const url = new URL(endpoint)
        // Checked at registration, and again here: a device may have come into the store another
        // way, or the list of hosts may have become shorter since.
        if (url.protocol !== 'https:' || !hostAllowed(url.hostname)) {
          return failed('the stored endpoint is not a push service this driver sends to')
        }

        const message = utf8(JSON.stringify(messageOf(payload)))
        if (message.length > WEB_PUSH_MAX_PAYLOAD) {
          return failed(
            `the payload is ${message.length} bytes, a push service takes ${WEB_PUSH_MAX_PAYLOAD}`,
          )
        }
        const headers: Record<string, string> = {
          Authorization: await authorization(url.origin),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(payload.ttl === undefined ? defaultTtl : checkedTtl(payload.ttl, '`ttl`')),
          Urgency: urgency,
        }
        // The push service keeps one pending message per topic: a device that comes back
        // online gets the newest of a kind, not all of them.
        if (payload.tag) headers.Topic = toBase64Url(await sha256(utf8(payload.tag))).slice(0, 32)

        request = {
          url,
          init: {
            method: 'POST',
            headers,
            body: await encryptWebPush(message, keys),
            // A push service answers; it does not send the request elsewhere.
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          },
        }
      } catch (error) {
        return failed(`the notification could not be prepared: ${messageOfError(error)}`)
      }

      let response: Response
      try {
        response = await (config.fetch ?? fetch)(request.url, request.init)
      } catch (error) {
        return failed(`the push service was not reached: ${messageOfError(error)}`)
      }

      if (response.ok) {
        await response.body?.cancel().catch(() => {})
        return { status: 'sent' }
      }
      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => {})
        return { status: 'gone', reason: `the push service answered ${response.status}` }
      }
      const detail = await excerptOf(response)
      return failed(
        `the push service answered ${response.status}${detail === '' ? '' : `: ${detail}`}`,
      )
    },
  }
}

/**
 * Encrypts a message for one subscription as RFC 8291 describes: an ECDH secret between a fresh
 * key pair and the browser's key, mixed with the subscription's auth secret, yields the key and
 * nonce of one AES-128-GCM record. `fixed` pins the salt and the key pair, for the test that
 * checks the result against the example in the RFC.
 */
export async function encryptWebPush(
  plaintext: Uint8Array<ArrayBuffer>,
  keys: { p256dh: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> },
  fixed?: { salt: Uint8Array<ArrayBuffer>; keyPair: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
  const browserKey = await crypto.subtle.importKey('raw', keys.p256dh, ECDH, false, [])
  const keyPair = fixed?.keyPair ?? (await crypto.subtle.generateKey(ECDH, true, ['deriveBits']))
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: browserKey }, keyPair.privateKey, 256),
  )

  const ikm = await hkdf(
    keys.auth,
    shared,
    concat(utf8('WebPush: info\0'), keys.p256dh, serverPublic),
    32,
  )
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      // 0x02 ends the last record; this message is one record.
      concat(plaintext, new Uint8Array([2])),
    ),
  )

  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE)
  return concat(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext)
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

/** The start of what a push service answered: its first chunk, 200 characters at most */
async function excerptOf(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader()
    if (!reader) return ''
    const { value } = await reader.read()
    await reader.cancel().catch(() => {})
    return new TextDecoder().decode(value).trim().slice(0, 200)
  } catch {
    return ''
  }
}

/** What the service worker receives: `event.data.json()` */
function messageOf(payload: PushPayload): Record<string, unknown> {
  return {
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    icon: payload.icon,
    data: payload.data,
  }
}

function endpointOf(input: PushDeviceInput): URL {
  const subscription: unknown = input?.subscription
  const endpoint = isRecord(subscription) ? subscription.endpoint : undefined
  if (typeof endpoint !== 'string' || endpoint === '' || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw new PushDeviceError(
      'web-push: `subscription.endpoint` is missing; hand over what PushSubscription.toJSON() returns',
    )
  }
  try {
    return new URL(endpoint)
  } catch {
    throw new PushDeviceError('web-push: `subscription.endpoint` is not a URL')
  }
}

function keysOf(
  value: unknown,
): { p256dh: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> } | null {
  if (!isRecord(value) || typeof value.p256dh !== 'string' || typeof value.auth !== 'string') {
    return null
  }
  const p256dh = fromBase64Url(value.p256dh)
  const auth = fromBase64Url(value.auth)
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4 || !auth || auth.length !== 16) {
    return null
  }
  return { p256dh, auth }
}

function checkedTtl(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new NotificationsError(`web-push: ${name} has to be a whole number of seconds, 0 or more`)
  }
  return value
}

function messageOfError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
