import type { CacheDriver } from '../types.js'

interface CacheEntry {
  value: unknown
  expiresAt: number | null
}

/**
 * In-memory cache driver with TTL support.
 */
export function createMemoryDriver(): CacheDriver {
  const store = new Map<string, CacheEntry>()

  function isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const entry = store.get(key)
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(key)
        return null
      }
      return entry.value as T
    },

    async set(key: string, value: unknown, ttl?: number): Promise<void> {
      const expiresAt = ttl ? Date.now() + ttl * 1000 : null
      store.set(key, { value, expiresAt })
    },

    async has(key: string): Promise<boolean> {
      const entry = store.get(key)
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(key)
        return false
      }
      return true
    },

    async delete(key: string): Promise<boolean> {
      return store.delete(key)
    },

    async flush(): Promise<void> {
      store.clear()
    },
  }
}
