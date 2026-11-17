import type { DeviceStore, PushDevice } from '../types.js'

/**
 * `DeviceStore` in the memory of this process: for development and tests. Nothing survives a
 * restart, and on Cloudflare Workers every isolate has its own.
 */
export function createMemoryDeviceStore(): DeviceStore {
  const devicesOf = new Map<string, PushDevice[]>()
  const ownerOf = new Map<string, string>()

  function drop(userId: string, deviceId: string): boolean {
    const devices = devicesOf.get(userId) ?? []
    const kept = devices.filter((device) => device.id !== deviceId)
    if (kept.length === devices.length) return false
    if (kept.length === 0) devicesOf.delete(userId)
    else devicesOf.set(userId, kept)
    return true
  }

  return {
    async list(userId) {
      return structuredClone(devicesOf.get(userId) ?? [])
    },

    async put(userId, device) {
      const previous = ownerOf.get(device.id)
      if (previous !== undefined) drop(previous, device.id)
      ownerOf.set(device.id, userId)
      devicesOf.set(userId, [...(devicesOf.get(userId) ?? []), structuredClone(device)])
    },

    async remove(userId, deviceId) {
      if (!drop(userId, deviceId)) return false
      ownerOf.delete(deviceId)
      return true
    },

    async removeAll(userId) {
      const devices = devicesOf.get(userId) ?? []
      for (const device of devices) ownerOf.delete(device.id)
      devicesOf.delete(userId)
      return devices.length
    },
  }
}
