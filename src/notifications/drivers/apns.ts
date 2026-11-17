/**
 * APNs: notifications for an app on an iPhone or iPad, through Apple's push service. A web view
 * inside an app from the App Store gets no Web Push, so its shell hands over the device token
 * Apple gave it and the server posts to Apple's provider API, signed with the team's key.
 * Web Crypto and `fetch` only: no dependency. Apple's API speaks HTTP/2 only, so it needs a
 * `fetch` that does.
 */
import { NotificationsError, PushDeviceError } from '../errors.js'
import type { PushDelivery, PushDeviceInput, PushDriver, PushPayload } from '../types.js'
import { fromBase64Url, sha256, signEs256Jwt, toBase64Url, utf8 } from './encoding.js'

/** Apple runs two push services: a token of one is unknown to the other */
export type ApnsEnvironment = 'production' | 'sandbox'

/** What an app hands to `devices.register()` for an iPhone or iPad */
export interface ApnsDeviceInput extends PushDeviceInput {
  kind: 'apns'
  /** The device token the app got from Apple, as hexadecimal digits */
  token: string
  /**
   * The service that issued the token: `'sandbox'` for a build run from Xcode (the entitlement
   * `aps-environment` is `development`), `'production'` for TestFlight and the App Store.
   */
  environment: ApnsEnvironment
}

/** What the register stores for an iPhone or iPad */
export type ApnsTarget = { token: string; environment: ApnsEnvironment }

/** A signing key of the team: its id and the contents of the `.p8` file */
export interface ApnsKey {
  /** The Key ID Apple shows next to the key */
  keyId: string
  /** The contents of the `.p8` file. A secret that opens every app of the team */
  privateKey: string
}

export interface ApnsDriverConfig extends ApnsKey {
  /** The Team ID of the developer account */
  teamId: string
  /** The bundle id of the app the notifications are for; it is the topic of every request */
  bundleId: string
  /**
   * A key of its own for Apple's sandbox, for a team whose keys are bound to one environment
   * each. Without it, `keyId` and `privateKey` sign for both.
   */
  sandbox?: ApnsKey
  /**
   * Seconds Apple keeps a notification for a device that is offline (default: 86400, a day).
   * `0` tries once and keeps nothing. `ttl` on a payload wins.
   */
  ttl?: number
  /** The sound a notification plays: a file in the app's bundle, or `false` for none (default: `'default'`) */
  sound?: string | false
  /** Milliseconds to wait for Apple (default: 10000) */
  timeoutMs?: number
  /** Replaces the global `fetch`: for tests, and for a runtime whose own `fetch` speaks no HTTP/2 */
  fetch?: typeof fetch
}

/** The JSON of a notification may be this many bytes; Apple refuses a larger one */
export const APNS_MAX_PAYLOAD = 4096

const HOSTS: Record<ApnsEnvironment, string> = {
  production: 'api.push.apple.com',
  sandbox: 'api.sandbox.push.apple.com',
}
const DEFAULT_TTL = 86_400
const DEFAULT_TIMEOUT_MS = 10_000
/**
 * Apple takes a token for an hour and reports one that is replaced within twenty minutes, so a
 * token is signed once and used for 45 minutes.
 */
const TOKEN_SECONDS = 45 * 60
const MAX_TOKEN_LENGTH = 512
const MAX_COLLAPSE_ID_LENGTH = 64
/** What Apple answers for a token that will never work again: the register drops the device */
const GONE_REASONS: readonly string[] = ['BadDeviceToken', 'ExpiredToken', 'Unregistered']

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const

/**
 * Create the APNs driver.
 *
 * Usage:
 *   const notifications = createNotifications({
 *     channels: {
 *       push: {
 *         store: createMemoryDeviceStore(),
 *         drivers: [createApnsDriver({ teamId, keyId, privateKey, bundleId: 'com.example.app' })],
 *       },
 *     },
 *   })
 *   await notifications.devices.register(userId, { kind: 'apns', token, environment: 'production' })
 */
export function createApnsDriver(config: ApnsDriverConfig): PushDriver<ApnsTarget> {
  const teamId = checkedId(config?.teamId, '`teamId`')
  const bundleId = config.bundleId
  if (typeof bundleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(bundleId)) {
    throw new NotificationsError(
      'apns: `bundleId` has to be the bundle id of the app, like "com.example.app"',
    )
  }
  const production = checkedKey(config, '')
  const keys: Record<ApnsEnvironment, CheckedKey> = {
    production,
    sandbox: config.sandbox === undefined ? production : checkedKey(config.sandbox, 'sandbox.'),
  }
  const defaultTtl = checkedTtl(config.ttl ?? DEFAULT_TTL)
  const sound = config.sound ?? 'default'
  if (sound !== false && (typeof sound !== 'string' || sound === '')) {
    throw new NotificationsError('apns: `sound` has to be the name of a sound or `false`')
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // One token per key, signed once for everyone who asks while it is being signed: Apple
  // reports a provider that changes its token more often than every twenty minutes.
  const tokens = new Map<CheckedKey, { value: Promise<string>; refreshAt: number }>()
  function providerToken(key: CheckedKey): Promise<string> {
    const now = Date.now()
    const cached = tokens.get(key)
    if (cached && cached.refreshAt > now) return cached.value
    const value = importSigningKey(key).then((signingKey) =>
      signEs256Jwt(
        signingKey,
        { alg: 'ES256', kid: key.keyId },
        { iss: teamId, iat: Math.floor(now / 1000) },
      ),
    )
    tokens.set(key, { value, refreshAt: now + TOKEN_SECONDS * 1000 })
    // A key that cannot sign is asked again next time instead of failing from the cache.
    value.catch(() => {
      if (tokens.get(key)?.value === value) tokens.delete(key)
    })
    return value
  }

  return {
    kind: 'apns',

    keyOf(input) {
      const target = targetOf(input)
      return `${target.environment}:${target.token}`
    },

    targetOf,

    async send(target, payload): Promise<PushDelivery> {
      const token = typeof target?.token === 'string' ? target.token : ''
      // Whatever goes into a reason is read by people and logs: never the device token.
      const scrub = (text: string): string =>
        token === '' ? text : text.split(token).join('[token]')
      const failed = (reason: string): PushDelivery => ({ status: 'failed', reason: scrub(reason) })

      const environment = target?.environment
      if (!isToken(token) || (environment !== 'production' && environment !== 'sandbox')) {
        return failed('the stored device is not an APNs device token')
      }
      const key = keys[environment]

      let request: { url: string; init: RequestInit }
      try {
        const body = utf8(JSON.stringify(messageOf(payload, sound)))
        if (body.length > APNS_MAX_PAYLOAD) {
          return failed(`the payload is ${body.length} bytes, Apple takes ${APNS_MAX_PAYLOAD}`)
        }
        const ttl = payload.ttl === undefined ? defaultTtl : checkedTtl(payload.ttl)
        const headers: Record<string, string> = {
          authorization: `bearer ${await providerToken(key)}`,
          'apns-topic': bundleId,
          'apns-push-type': 'alert',
          // 0 is Apple's word for "try once and keep nothing"; anything else is a date.
          'apns-expiration': ttl === 0 ? '0' : String(Math.floor(Date.now() / 1000) + ttl),
          'content-type': 'application/json',
        }
        // A notification replaces the one of the same collapse id, on the device and at Apple
        // while the device is offline.
        if (payload.tag) headers['apns-collapse-id'] = await collapseIdOf(payload.tag)

        request = {
          // The host is one of Apple's two and the token is hexadecimal digits: nothing a
          // client hands over decides where this request goes.
          url: `https://${HOSTS[environment]}/3/device/${token}`,
          init: {
            method: 'POST',
            headers,
            body,
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
        const message = messageOfError(error)
        // What Node's `fetch` reports when it spoke HTTP/1.1 and Apple answered in HTTP/2.
        if (/HTTP\/1\.1/i.test(message)) {
          return failed(
            'Apple was not reached: its push service speaks HTTP/2 only and the `fetch` of this runtime does not. Run on a runtime whose `fetch` does, or hand one over as `fetch`.',
          )
        }
        return failed(`Apple was not reached: ${message}`)
      }

      if (response.status === 200) {
        await response.body?.cancel().catch(() => {})
        return { status: 'sent' }
      }
      const reason = await reasonOf(response)
      const answer = `Apple answered ${response.status}${reason === '' ? '' : ` ${reason}`}`
      if (response.status === 410 || GONE_REASONS.includes(reason)) {
        return { status: 'gone', reason: answer }
      }
      // Apple no longer takes the token this driver holds: the next notification signs anew.
      if (reason === 'ExpiredProviderToken') tokens.delete(key)
      return failed(answer)
    },
  }
}

interface CheckedKey {
  keyId: string
  /** The PKCS #8 bytes of the `.p8` file */
  pkcs8: Uint8Array<ArrayBuffer>
  /** `privateKey` or `sandbox.privateKey`, for a message */
  name: string
  imported?: Promise<CryptoKey>
}

function checkedKey(key: ApnsKey, prefix: string): CheckedKey {
  const name = `\`${prefix}privateKey\``
  const keyId = checkedId(key?.keyId, `\`${prefix}keyId\``)
  const pem = key?.privateKey
  // An environment variable often carries the line breaks of the file as the two characters `\n`.
  const pkcs8 =
    typeof pem === 'string'
      ? fromBase64Url(
          pem
            .replace(/\\n/g, '\n')
            .replace(/-----[A-Z ]+-----/g, '')
            .replace(/\s+/g, ''),
        )
      : null
  if (!pkcs8) {
    throw new NotificationsError(
      `apns: ${name} has to be the contents of the .p8 file Apple gave you for the key`,
    )
  }
  return { keyId, pkcs8, name }
}

function importSigningKey(key: CheckedKey): Promise<CryptoKey> {
  return (key.imported ??= crypto.subtle
    .importKey('pkcs8', key.pkcs8, ECDSA, false, ['sign'])
    .catch(() => {
      throw new NotificationsError(
        `${key.name} is not a signing key: it has to be the contents of the .p8 file Apple gave you`,
      )
    }))
}

function checkedId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
    throw new NotificationsError(
      `apns: ${name} has to be the id Apple shows in the developer account: ten letters and digits`,
    )
  }
  return value
}

function checkedTtl(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new NotificationsError('apns: `ttl` has to be a whole number of seconds, 0 or more')
  }
  return value
}

function isToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/.test(value)
  )
}

function targetOf(input: PushDeviceInput): ApnsTarget {
  const token = typeof input?.token === 'string' ? input.token.toLowerCase() : ''
  if (!isToken(token)) {
    throw new PushDeviceError(
      'apns: `token` has to be the device token as hexadecimal digits, without spaces or brackets',
    )
  }
  const environment = input.environment
  if (environment !== 'production' && environment !== 'sandbox') {
    throw new PushDeviceError(
      "apns: `environment` has to be 'production' or 'sandbox', the service that issued the token",
    )
  }
  return { token, environment }
}

/** What the app receives: `aps` for the system, the rest in `userInfo` for the app's own code */
function messageOf(payload: PushPayload, sound: string | false): Record<string, unknown> {
  return {
    aps: {
      alert: { title: payload.title, body: payload.body },
      ...(sound === false ? {} : { sound }),
    },
    url: payload.url,
    tag: payload.tag,
    data: payload.data,
  }
}

/**
 * A tag of up to 64 visible ASCII characters is the collapse id itself, so it reads the same in
 * Apple's console. Anything else goes as its hash: a header carries no other characters, and
 * Apple takes 64 bytes.
 */
async function collapseIdOf(tag: string): Promise<string> {
  if (tag.length <= MAX_COLLAPSE_ID_LENGTH && /^[\x21-\x7e]+$/.test(tag)) return tag
  return toBase64Url(await sha256(utf8(tag)))
}

/** The `reason` of Apple's answer, or `''` when the answer is not one of Apple's */
async function reasonOf(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader()
    if (!reader) return ''
    const { value } = await reader.read()
    await reader.cancel().catch(() => {})
    const parsed: unknown = JSON.parse(new TextDecoder().decode(value))
    const reason = isRecord(parsed) ? parsed.reason : undefined
    return typeof reason === 'string' && /^[A-Za-z]{1,64}$/.test(reason) ? reason : ''
  } catch {
    return ''
  }
}

/** The message of an error and of what caused it: `fetch` says only "fetch failed" itself */
function messageOfError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause: unknown = error.cause
  return cause instanceof Error && cause.message !== ''
    ? `${error.message} (${cause.message})`
    : error.message
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
