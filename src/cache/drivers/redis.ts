import type { CacheDriver } from '../types.js'

export interface RedisCacheDriverOptions {
  /** A Redis client instance (ioredis or node-redis v4+) */
  client: {
    get(key: string): Promise<string | null>
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>
    del(key: string | string[]): Promise<number>
    exists(key: string | string[]): Promise<number>
    flushdb(): Promise<unknown>
  }
  /** Key prefix to namespace cache entries */
  prefix?: string
}

/**
 * Redis-backed cache driver.
 *
 * Accepts any Redis client that implements get/set/del/exists/flushdb.
 * Compatible with ioredis and node-redis v4+.
 */
export function createRedisDriver(options: RedisCacheDriverOptions): CacheDriver {
  const client = options.client
  const prefix = options.prefix ?? 'cache:'

  function prefixed(key: string): string {
    return `${prefix}${key}`
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await client.get(prefixed(key))
      if (raw === null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    async set(key: string, value: unknown, ttl?: number): Promise<void> {
      const raw = JSON.stringify(value)
      if (ttl) {
        await client.set(prefixed(key), raw, 'EX', ttl)
      } else {
        await client.set(prefixed(key), raw)
      }
    },

    async has(key: string): Promise<boolean> {
      const result = await client.exists(prefixed(key))
      return result > 0
    },

    async delete(key: string): Promise<boolean> {
      const result = await client.del(prefixed(key))
      return result > 0
    },

    async flush(): Promise<void> {
      await client.flushdb()
    },
  }
}
