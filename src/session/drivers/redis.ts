import type { SessionDriver, SessionData } from '../types.js'

/** Minimal Redis client interface — compatible with `ioredis` and `redis` (v4). */
export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, exMode: 'EX', seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

/**
 * Redis session driver.
 *
 * Requires a Redis client to be passed in. Compatible with `ioredis` and
 * the official `redis` package (v4+).
 *
 * Usage:
 *   import { createClient } from 'redis'
 *   const redis = createClient()
 *   await redis.connect()
 *
 *   const driver = createRedisDriver(redis, { ttl: 3600 })
 */
export function createRedisDriver(
  client: RedisClient,
  options: { ttl?: number; prefix?: string } = {},
): SessionDriver {
  const ttl = options.ttl ?? 7200
  const prefix = options.prefix ?? 'session:'

  function key(sessionId: string): string {
    return `${prefix}${sessionId}`
  }

  return {
    generateId(): string {
      return crypto.randomUUID()
    },

    async read(sessionId: string): Promise<SessionData> {
      const raw = await client.get(key(sessionId))
      if (!raw) return {}
      try {
        return JSON.parse(raw) as SessionData
      } catch {
        return {}
      }
    },

    async write(sessionId: string, data: SessionData, overrideTtl?: number): Promise<void> {
      await client.set(key(sessionId), JSON.stringify(data), 'EX', overrideTtl ?? ttl)
    },

    async destroy(sessionId: string): Promise<void> {
      await client.del(key(sessionId))
    },
  }
}

