/**
 * Fake push driver: records what was sent to which device and lets a test decide how a device
 * answers. It takes the place of the Web Push driver, so the app's own registration code runs
 * unchanged in a test.
 *
 * Usage:
 *   const fakePush = createFakePushDriver()
 *   const notifications = createNotifications({
 *     channels: { push: { store: createMemoryDeviceStore(), drivers: [fakePush] } },
 *   })
 *
 *   await notifications.devices.register('u1', fakePush.device('laptop'))
 *   await notifications.notify({ id: 'u1' }, reminder)
 *   expect(fakePush.sent[0]?.payload.title).toBe('Kick-off in an hour')
 *
 *   fakePush.gone('laptop') // from now on the push service no longer knows this device
 */

import type {
  PushDelivery,
  PushDeviceInput,
  PushDriver,
  PushPayload,
} from '../notifications/index.js'
import { PushDeviceError } from '../notifications/index.js'

/** What the fake stores for a device: the key that identified it at registration */
export type FakePushTarget = { key: string }

export interface FakePushSent {
  /** The key of the device: the endpoint, token or id it was registered with */
  key: string
  payload: PushPayload
}

export interface FakePushDriver extends PushDriver<FakePushTarget> {
  /** Every notification a device took since creation or the last clear() */
  readonly sent: FakePushSent[]
  /**
   * A device to register, in the shape of this driver's kind. For `web-push` it is a
   * subscription whose endpoint ends in `name`; the name is its key in `sent`, `gone()` and
   * `fail()`.
   */
  device(name: string): PushDeviceInput
  /** From now on the device answers as gone, as a push service does for a subscription it dropped */
  gone(key: string): void
  /** From now on the device answers as failed, as a push service that is down does */
  fail(key: string, reason?: string): void
  /** Forget what was sent and how devices answer */
  clear(): void
}

export interface FakePushDriverOptions {
  /** The kind of device the fake stands in for (default: `'web-push'`) */
  kind?: string
}

const ENDPOINT = 'https://fake-push.test/send/'

export function createFakePushDriver(options: FakePushDriverOptions = {}): FakePushDriver {
  const kind = options.kind ?? 'web-push'
  const sent: FakePushSent[] = []
  const answers = new Map<string, PushDelivery>()

  // A device is known by its name when it came from `device()`, otherwise by what the app
  // handed over: a subscription's endpoint, a token, an id.
  function keyOf(input: PushDeviceInput): string {
    const subscription: unknown = input.subscription
    const endpoint =
      typeof subscription === 'object' && subscription !== null
        ? (subscription as { endpoint?: unknown }).endpoint
        : undefined
    const key = endpoint ?? input.token ?? input.id
    if (typeof key !== 'string' || key === '') {
      throw new PushDeviceError(
        'fake push: a device needs `subscription.endpoint`, `token` or `id` to be told apart',
      )
    }
    return key.startsWith(ENDPOINT) ? key.slice(ENDPOINT.length) : key
  }

  return {
    kind,
    sent,

    keyOf,

    targetOf(input) {
      return { key: keyOf(input) }
    },

    async send(target, payload) {
      const answer = answers.get(target.key)
      if (answer) return answer
      sent.push({ key: target.key, payload })
      return { status: 'sent' }
    },

    device(name) {
      return kind === 'web-push'
        ? {
            kind,
            subscription: {
              endpoint: `${ENDPOINT}${name}`,
              keys: { p256dh: 'fake', auth: 'fake' },
            },
          }
        : { kind, id: name }
    },

    gone(key) {
      answers.set(key, { status: 'gone', reason: 'the fake push service answered 410' })
    },

    fail(key, reason = 'the fake push service answered 500') {
      answers.set(key, { status: 'failed', reason })
    },

    clear() {
      sent.length = 0
      answers.clear()
    },
  }
}
