import type { RateLimitKvConfig, RateLimiter, RateLimitResult } from './types.js'

/** KV keeps a key for at least 60 seconds, and a write can take that long to show elsewhere. */
const KV_MIN_TTL_SECONDS = 60

interface WindowEntry {
  count: number
  resetAt: number
}

/**
 * A fixed-window rate limiter on a Cloudflare KV namespace, for where the Rate Limiting binding
 * cannot be bound (Pages Functions): the count lives outside the isolate.
 *
 * The limit is soft. KV is eventually consistent and the count is read, add one, write: hits
 * that arrive together, or in two locations within the minute a write takes to travel, can share
 * a count. KV also takes one write per second per key; a faster second hit can make `put` reject,
 * and `check` rejects with it. It fits low limits over minutes (login attempts, mails per
 * address), not per-request throttling.
 *
 * The window's end is stored in the value and decides; the key's KV expiry only clears it away.
 * A hit over the limit writes nothing, so it neither extends the window nor costs a write.
 *
 * Usage:
 *   const limiter = createKvRateLimiter({ namespace: env.LIMITS, windowMs: 15 * 60_000, max: 3 })
 *   const { allowed } = await limiter.check(`login-code:${email}`)
 */
export function createKvRateLimiter(config: RateLimitKvConfig): RateLimiter {
  const { namespace, windowMs, max } = config
  const prefix = config.prefix ?? 'ratelimit'

  if (!(windowMs >= KV_MIN_TTL_SECONDS * 1000)) {
    throw new Error(
      `createKvRateLimiter: windowMs must be at least 60000, got ${windowMs}. ` +
        'KV keeps a key for 60 seconds at the least and takes as long to spread a write.',
    )
  }

  function write(storeKey: string, entry: WindowEntry, now: number): Promise<void> {
    const expirationTtl = Math.max(KV_MIN_TTL_SECONDS, Math.ceil((entry.resetAt - now) / 1000))
    return namespace.put(storeKey, JSON.stringify(entry), { expirationTtl })
  }

  return {
    async check(key: string): Promise<RateLimitResult> {
      const storeKey = `${prefix}:${key}`
      const now = Date.now()
      const entry = parseEntry(await namespace.get(storeKey))

      if (!entry || entry.resetAt <= now) {
        const resetAt = now + windowMs
        await write(storeKey, { count: 1, resetAt }, now)
        return { allowed: max >= 1, remaining: Math.max(0, max - 1), resetAt: new Date(resetAt) }
      }

      const resetAt = new Date(entry.resetAt)
      if (entry.count >= max) return { allowed: false, remaining: 0, resetAt }

      const count = entry.count + 1
      await write(storeKey, { count, resetAt: entry.resetAt }, now)
      return { allowed: true, remaining: max - count, resetAt }
    },

    async reset(key: string): Promise<void> {
      await namespace.delete(`${prefix}:${key}`)
    },
  }
}

/** A value this limiter wrote; anything else under the key counts as no window. */
function parseEntry(raw: string | null): WindowEntry | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { count, resetAt } = value as Record<string, unknown>
    return typeof count === 'number' && typeof resetAt === 'number' ? { count, resetAt } : null
  } catch {
    return null
  }
}
