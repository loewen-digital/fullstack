import type { CacheConfig } from '../config/types.js'
import type { CacheDriver, CacheInstance } from './types.js'
import { createMemoryDriver } from './drivers/memory.js'

export type { CacheConfig, CacheDriver, CacheInstance } from './types.js'
export { createMemoryDriver } from './drivers/memory.js'
export { createRedisDriver } from './drivers/redis.js'
export { createKvDriver } from './drivers/kv.js'

/**
 * Create a cache instance.
 *
 * Usage:
 *   const cache = createCache({ driver: 'memory' })
 *   await cache.set('key', 'value', 60)
 *   const val = await cache.get('key')
 */
export function createCache(config: CacheConfig): CacheInstance {
  let driver: CacheDriver

  if (config.driver === 'memory') {
    driver = createMemoryDriver()
  } else if (config.driver === 'redis') {
    throw new Error(
      'Redis cache driver requires a Redis client. ' +
        'Import createRedisDriver from @loewen-digital/fullstack/cache and pass your client.',
    )
  } else if (config.driver === 'kv') {
    throw new Error(
      'KV cache driver requires a Cloudflare KV namespace. ' +
        'Import createKvDriver from @loewen-digital/fullstack/cache and pass your namespace.',
    )
  } else if (typeof config.driver === 'object') {
    driver = config.driver as CacheDriver
  } else {
    throw new Error(`Unknown cache driver: "${config.driver}"`)
  }

  const defaultTtl = config.ttl ? parseTtl(config.ttl) : undefined

  return createCacheInstance(driver, defaultTtl)
}

/**
 * Low-level factory: create a cache instance from any CacheDriver.
 */
export function createCacheInstance(driver: CacheDriver, defaultTtl?: number): CacheInstance {
  return {
    get: <T = unknown>(key: string) => driver.get<T>(key),

    set: (key, value, ttl?) => driver.set(key, value, ttl ?? defaultTtl),

    has: (key) => driver.has(key),

    delete: (key) => driver.delete(key),

    flush: () => driver.flush(),

    async remember<T>(key: string, ttl: number, fn: () => T | Promise<T>): Promise<T> {
      const existing = await driver.get<T>(key)
      if (existing !== null) return existing
      const value = await fn()
      await driver.set(key, value, ttl)
      return value
    },
  }
}

function parseTtl(value: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(value)
  if (!match) return 3600
  const num = parseInt(match[1]!, 10)
  const unit = match[2] ?? 's'
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return num * (multipliers[unit] ?? 1)
}
