/**
 * Fake storage driver — in-memory file system for tests.
 *
 * Wraps the built-in memory driver with extra test helpers.
 *
 * Usage:
 *   const fakeStorage = createFakeStorageDriver()
 *   const storage = createStorageInstance(fakeStorage)
 *
 *   await storage.put('avatar.png', new TextEncoder().encode('img-data'))
 *   expect(await storage.exists('avatar.png')).toBe(true)
 *   fakeStorage.clear()
 */

import type { StorageDriver, FileMeta } from '../storage/index.js'

export interface FakeStorageDriver extends StorageDriver {
  /** All keys currently in the fake store */
  keys(): string[]
  /** Number of files in the fake store */
  readonly size: number
  /** Clear all files */
  clear(): void
  // Override getUrl to be sync-compatible for test assertions
  getUrl(key: string): Promise<string>
}

export function createFakeStorageDriver(baseUrl = 'http://localhost/storage'): FakeStorageDriver {
  const store = new Map<string, Uint8Array>()

  function toUint8Array(data: Uint8Array | string | ReadableStream): Promise<Uint8Array> {
    if (typeof data === 'string') {
      return Promise.resolve(new TextEncoder().encode(data))
    }
    if (data instanceof Uint8Array) {
      return Promise.resolve(data)
    }
    // ReadableStream
    return new Response(data).arrayBuffer().then(buf => new Uint8Array(buf))
  }

  return {
    async get(key: string): Promise<Uint8Array | null> {
      return store.get(key) ?? null
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, _meta?: FileMeta): Promise<void> {
      store.set(key, await toUint8Array(data))
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async exists(key: string): Promise<boolean> {
      return store.has(key)
    },

    async list(prefix?: string): Promise<string[]> {
      const allKeys = [...store.keys()]
      return prefix ? allKeys.filter(k => k.startsWith(prefix)) : allKeys
    },

    async getUrl(key: string): Promise<string> {
      return `${baseUrl}/${key}`
    },

    keys(): string[] {
      return [...store.keys()]
    },

    get size(): number {
      return store.size
    },

    clear(): void {
      store.clear()
    },
  }
}
