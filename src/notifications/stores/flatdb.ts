import { NotificationsError } from '../errors.js'
import type { DeviceStore, PushDevice } from '../types.js'

/**
 * The slice of a flatdb `StorageAdapter` this store uses.
 *
 * Declared here so this file never imports `@loewen-digital/flatdb` (an optional peer
 * dependency); `FsAdapter`, `R2Adapter`, `MemoryAdapter` and `IndexedDBAdapter` of flatdb 0.3
 * satisfy it structurally. `readVersioned` and `writeIf` are optional in flatdb's own interface
 * and required here: they are what keeps two registrations at once from losing one.
 */
export interface FlatdbDeviceAdapter {
  read(path: string): Promise<string | null>
  write(path: string, data: string): Promise<void>
  delete(path: string): Promise<void>
  readVersioned?(path: string): Promise<{ data: string | null; version: string | null }>
  writeIf?(path: string, data: string, version: string | null): Promise<string | null>
}

export interface FlatdbDeviceStoreConfig {
  /** The adapter the app's `flatdb()` runs on */
  adapter: FlatdbDeviceAdapter
  /**
   * The folder below the adapter's root (default: `push`). It must not be the name of a
   * collection: the store writes its own files there, without a collection index.
   */
  prefix?: string
}

const ATTEMPTS = 20

/**
 * `DeviceStore` on the storage adapter of `@loewen-digital/flatdb`: one JSON file per user with
 * that user's devices under `<prefix>/users/`, and one per device under `<prefix>/owners/` that
 * names the user holding it, so a device that changes hands is found at its previous user.
 *
 * A user's file is changed with a compare-and-swap (`readVersioned`, then `writeIf` with the
 * version read): a writer that lost the race reads again and re-applies its change, so two
 * browsers of one user that register in the same instant are both kept. The guarantee is the
 * adapter's: across every Worker isolate with `R2Adapter`, within one process with `FsAdapter`.
 * Removing all devices of a user deletes the user's file: nothing named after the account stays.
 *
 * Usage:
 *   const adapter = new R2Adapter({ bucket: env.DATA })
 *   const store = createFlatdbDeviceStore({ adapter })
 */
export function createFlatdbDeviceStore(config: FlatdbDeviceStoreConfig): DeviceStore {
  const { adapter } = config
  const readVersioned = adapter.readVersioned?.bind(adapter)
  const writeIf = adapter.writeIf?.bind(adapter)
  if (!readVersioned || !writeIf) {
    throw new NotificationsError(
      'flatdb device store: the adapter has no readVersioned/writeIf. Without conditional writes ' +
        'two registrations for one user can overwrite each other; use an adapter of @loewen-digital/flatdb 0.3 or later.',
    )
  }
  const prefix = (config.prefix ?? 'push').replace(/^\/+|\/+$/g, '')
  const userPath = (userId: string): string => `${prefix}/users/${fileName(userId)}.json`
  const ownerPath = (deviceId: string): string => `${prefix}/owners/${fileName(deviceId)}.json`

  /** Reads the user's devices, applies `change` and stores the result unless it is `null` */
  async function change<R>(
    userId: string,
    apply: (devices: PushDevice[]) => { devices: PushDevice[] | null; result: R },
  ): Promise<R> {
    const path = userPath(userId)
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const { data, version } = await readVersioned!(path)
      const { devices, result } = apply(data === null ? [] : parseDevices(data, userId))
      if (devices === null) return result
      if ((await writeIf!(path, JSON.stringify(serialize(userId, devices)), version)) !== null) {
        return result
      }
      // Another writer got there first: wait a moment so a burst spreads out, then read again.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)))
    }
    throw new NotificationsError(
      `flatdb device store: the devices of user ${JSON.stringify(userId)} could not be written, ` +
        `${ATTEMPTS} attempts lost against other writers.`,
    )
  }

  async function ownerOf(deviceId: string): Promise<string | null> {
    const data = await adapter.read(ownerPath(deviceId))
    if (data === null) return null
    const owner: unknown = JSON.parse(data)
    return isRecord(owner) && typeof owner.userId === 'string' ? owner.userId : null
  }

  const without = (devices: PushDevice[], deviceId: string): PushDevice[] | null => {
    const kept = devices.filter((device) => device.id !== deviceId)
    return kept.length === devices.length ? null : kept
  }

  return {
    async list(userId) {
      const data = await adapter.read(userPath(userId))
      return data === null ? [] : parseDevices(data, userId)
    },

    async put(userId, device) {
      const previous = await ownerOf(device.id)
      if (previous !== null && previous !== userId) {
        await change(previous, (devices) => ({
          devices: without(devices, device.id),
          result: undefined,
        }))
      }
      // The owner first: if this request dies before the user's file is written, the device is
      // in no list, which the next registration repairs.
      if (previous !== userId) {
        await adapter.write(ownerPath(device.id), JSON.stringify({ userId }))
      }
      await change(userId, (devices) => ({
        devices: [...devices.filter((entry) => entry.id !== device.id), device],
        result: undefined,
      }))
    },

    async remove(userId, deviceId) {
      const removed = await change(userId, (devices) => {
        const kept = without(devices, deviceId)
        return { devices: kept, result: kept !== null }
      })
      if (removed && (await ownerOf(deviceId)) === userId) {
        await adapter.delete(ownerPath(deviceId))
      }
      return removed
    },

    async removeAll(userId) {
      const path = userPath(userId)
      const data = await adapter.read(path)
      if (data === null) return 0
      const devices = parseDevices(data, userId)
      await adapter.delete(path)
      for (const device of devices) {
        if ((await ownerOf(device.id)) === userId) await adapter.delete(ownerPath(device.id))
      }
      return devices.length
    },
  }
}

/**
 * An id as a file name: lower-case letters, digits, `_` and `-` stay, every other byte becomes
 * `~xx`. Upper-case letters are escaped too, so `Abc` and `abc` stay two files on a file system
 * that ignores case; `/` and `.` cannot leave the folder.
 */
function fileName(id: string): string {
  let name = ''
  for (const byte of new TextEncoder().encode(id)) {
    const char = String.fromCharCode(byte)
    name += /[a-z0-9_-]/.test(char) ? char : `~${byte.toString(16).padStart(2, '0')}`
  }
  if (name === '' || name.length > 200) {
    throw new NotificationsError(
      `flatdb device store: ${JSON.stringify(id)} cannot be a file name (empty, or too long).`,
    )
  }
  return name
}

// Dates are stored as ISO 8601 strings (JSON has no `Date`) and returned as `Date`.
function serialize(userId: string, devices: PushDevice[]): Record<string, unknown> {
  return {
    userId,
    devices: devices.map((device) => ({
      id: device.id,
      kind: device.kind,
      target: device.target,
      registeredAt: device.registeredAt.toISOString(),
    })),
  }
}

function parseDevices(data: string, userId: string): PushDevice[] {
  const doc: unknown = JSON.parse(data)
  if (!isRecord(doc) || !Array.isArray(doc.devices)) {
    throw new NotificationsError(
      `flatdb device store: the file of user ${JSON.stringify(userId)} holds no devices.`,
    )
  }
  return doc.devices.map((value: unknown): PushDevice => {
    const registeredAt = isRecord(value) ? new Date(String(value.registeredAt)) : new Date(NaN)
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.kind !== 'string' ||
      Number.isNaN(registeredAt.getTime())
    ) {
      throw new NotificationsError(
        `flatdb device store: an entry in the file of user ${JSON.stringify(userId)} is not a device.`,
      )
    }
    return { id: value.id, kind: value.kind, target: value.target, registeredAt }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
