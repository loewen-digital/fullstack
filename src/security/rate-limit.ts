import type { RateLimitConfig, RateLimiter, RateLimitResult } from './types.js'

interface BucketEntry {
  count: number
  resetAt: number
}

/**
 * Create an in-memory rate limiter using a fixed window algorithm.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 100 })
 *   const result = limiter.check('user:123')
 *   if (!result.allowed) throw new RateLimitError()
 */
export function createRateLimiter(config: RateLimitConfig = {}): RateLimiter {
  const windowMs = config.windowMs ?? 60_000
  const max = config.max ?? 60
  const buckets = new Map<string, BucketEntry>()

  function cleanExpired(): void {
    const now = Date.now()
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) {
        buckets.delete(key)
      }
    }
  }

  return {
    check(key: string): RateLimitResult {
      cleanExpired()
      const now = Date.now()
      const entry = buckets.get(key)

      if (!entry || entry.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true, remaining: max - 1, resetAt: new Date(now + windowMs) }
      }

      entry.count++
      const allowed = entry.count <= max
      const remaining = Math.max(0, max - entry.count)
      return { allowed, remaining, resetAt: new Date(entry.resetAt) }
    },

    reset(key: string): void {
      buckets.delete(key)
    },
  }
}
