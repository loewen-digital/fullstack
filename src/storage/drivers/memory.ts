import type { StorageDriver, FileMeta } from '../types.js'

/**
 * In-memory storage driver for development and testing.
 */
export function createMemoryDriver(): StorageDriver {
  const store = new Map<string, { data: Uint8Array; meta: FileMeta }>()

  return {
    async get(key: string): Promise<Uint8Array | null> {
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

async function toBytes(data: Uint8Array | string | ReadableStream): Promise<Uint8Array> {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }
  if (data instanceof Uint8Array) {
    return data
  }
  // ReadableStream
  const reader = data.getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.byteLength
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
