import type { StorageDriver, FileMeta } from '../types.js'
import { toBytes } from '../bytes.js'

/**
 * In-memory storage driver for development and testing.
 */
export function createMemoryDriver(): StorageDriver {
  const store = new Map<string, { data: Uint8Array<ArrayBuffer>; meta: FileMeta }>()

  return {
    async get(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
      const entry = store.get(key)
      return entry ? entry.data : null
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, meta: FileMeta = {}): Promise<void> {
      const bytes = await toBytes(data)
      store.set(key, { data: bytes, meta })
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async exists(key: string): Promise<boolean> {
      return store.has(key)
    },

    async list(prefix?: string): Promise<string[]> {
      const keys: string[] = []
      for (const key of store.keys()) {
        if (!prefix || key.startsWith(prefix)) {
          keys.push(key)
        }
      }
      return keys.sort()
    },

    async getUrl(key: string): Promise<string> {
      return `memory://${key}`
    },
  }
}

