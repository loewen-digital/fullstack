import type { CacheDriver } from '../types.js'

export interface KvDriverOptions {
  /** A Cloudflare KV namespace binding */
  namespace: {
    get(key: string): Promise<string | null>
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
    delete(key: string): Promise<void>
    list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }>
  }
  /** Key prefix to namespace cache entries */
  prefix?: string
}

/**
 * Cloudflare KV cache driver.
 *
 * Accepts a KV namespace binding from the Workers runtime.
 */
export function createKvDriver(options: KvDriverOptions): CacheDriver {
  const ns = options.namespace
  const prefix = options.prefix ?? 'cache:'

  function prefixed(key: string): string {
    return `${prefix}${key}`
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await ns.get(prefixed(key))
      if (raw === null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    async set(key: string, value: unknown, ttl?: number): Promise<void> {
      const raw = JSON.stringify(value)
      await ns.put(prefixed(key), raw, ttl ? { expirationTtl: ttl } : undefined)
    },

    async has(key: string): Promise<boolean> {
      const raw = await ns.get(prefixed(key))
      return raw !== null
    },

    async delete(key: string): Promise<boolean> {
      await ns.delete(prefixed(key))
      return true
    },

    async flush(): Promise<void> {
      const result = await ns.list({ prefix })
      for (const key of result.keys) {
        await ns.delete(key.name)
      }
    },
  }
}
