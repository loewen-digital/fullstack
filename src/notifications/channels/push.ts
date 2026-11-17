import { NotificationsError, PushDeviceError } from '../errors.js'
import type {
  DeviceRegister,
  Notification,
  NotificationUser,
  PushConfig,
  PushDelivery,
  PushDevice,
  PushDeviceInput,
  PushDeviceReport,
  PushDriver,
} from '../types.js'

export interface PushChannel {
  devices: DeviceRegister
  /** Sends to every registered device of the user; one entry per device */
  deliver(user: NotificationUser, notification: Notification): Promise<PushDeviceReport[]>
}

/**
 * The push channel: the register of devices on the config's store, and the fan-out of one
 * notification to every device of a user through the driver of the device's kind.
 */
export function createPushChannel(config: PushConfig | undefined): PushChannel {
  if (
    config !== undefined &&
    (typeof config.store?.list !== 'function' || !Array.isArray(config.drivers))
  ) {
    throw new NotificationsError(
      'notifications: `channels.push` takes `{ store, drivers }`: a device store and one driver per kind of device. ' +
        'A driver with `send(userId, payload)`, as in earlier versions, is no longer a push channel.',
    )
  }
  const drivers = new Map<string, PushDriver>()
  for (const driver of config?.drivers ?? []) {
    if (drivers.has(driver.kind)) {
      throw new NotificationsError(
        `notifications: two push drivers of the kind "${driver.kind}"; a device could not tell which one reaches it.`,
      )
    }
    drivers.set(driver.kind, driver)
  }
  const report =
    config?.onError ??
    ((error: unknown) => console.error('notifications: a gone device was not removed', error))

  function configured(): PushConfig {
    if (!config) {
      throw new NotificationsError(
        'notifications: push is not configured. Pass `channels.push` with a store and at least one driver.',
      )
    }
    return config
  }

  function driverOf(input: PushDeviceInput): PushDriver {
    const kind: unknown = (input as { kind?: unknown } | null)?.kind
    if (typeof kind !== 'string' || kind === '') {
      throw new PushDeviceError('notifications: a device needs a `kind`, such as "web-push"')
    }
    const driver = drivers.get(kind)
    if (!driver) {
      throw new PushDeviceError(`notifications: no push driver for devices of the kind "${kind}"`)
    }
    return driver
  }

  return {
    devices: {
      async register(userId, input) {
        const { store } = configured()
        requireUserId(userId)
        const driver = driverOf(input)
        const target = await driver.targetOf(input)
        const device: PushDevice = {
          id: await deviceId(driver.kind, driver.keyOf(input)),
          kind: driver.kind,
          target,
          registeredAt: new Date(),
        }
        await store.put(userId, device)
        return device
      },

      async unregister(userId, device) {
        const { store } = configured()
        requireUserId(userId)
        if (typeof device === 'string') return store.remove(userId, device)
        const driver = driverOf(device)
        return store.remove(userId, await deviceId(driver.kind, driver.keyOf(device)))
      },

      async list(userId) {
        requireUserId(userId)
        return configured().store.list(userId)
      },

      async forget(userId) {
        requireUserId(userId)
        return configured().store.removeAll(userId)
      },
    },

    async deliver(user, notification) {
      const { store } = configured()
      if (!notification.toPush) {
        throw new Error('Notification does not implement toPush()')
      }
      const payload = notification.toPush(user)
      const userId = String(user.id)
      const devices = await store.list(userId)

      // Every device on its own: one that fails or hangs does not keep the others waiting.
      return Promise.all(
        devices.map(async (device): Promise<PushDeviceReport> => {
          const driver = drivers.get(device.kind)
          let delivery: PushDelivery
          if (!driver) {
            delivery = { status: 'failed', reason: `no push driver for the kind "${device.kind}"` }
          } else {
            try {
              delivery = await driver.send(device.target, payload)
            } catch (error) {
              // A driver answers instead of throwing; one of your own may not.
              delivery = {
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error),
              }
            }
          }
          if (delivery.status === 'gone') {
            try {
              await store.remove(userId, device.id)
            } catch (error) {
              report(error)
            }
          }
          return {
            deviceId: device.id,
            kind: device.kind,
            status: delivery.status,
            ...(delivery.status === 'sent' || delivery.reason === undefined
              ? {}
              : { reason: delivery.reason }),
          }
        }),
      )
    },
  }
}

/**
 * The id of a device: SHA-256 over its kind and its key, as hex. The same device gives the same
 * id every time, and the id says nothing about the endpoint or token it was made from.
 */
export async function deviceId(kind: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}\n${key}`))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function requireUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '') {
    throw new NotificationsError('notifications: userId must be a non-empty string')
  }
}
