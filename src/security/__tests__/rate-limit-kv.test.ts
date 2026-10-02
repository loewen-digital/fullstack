import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test'
import type { KVNamespace } from '@cloudflare/workers-types'
import { createKvRateLimiter, createRateLimiter, createSecurity } from '../index.js'
import type { RateLimitKvNamespace } from '../index.js'

const MINUTE = 60_000
const START = Date.UTC(2026, 0, 1, 12, 0, 0)

/**
 * A KV namespace in memory: keys expire with their `expirationTtl`, every call is recorded.
 * `rejectPut` makes the next writes fail, as KV does for a second write to a key within a second.
 */
function fakeKv() {
  const store = new Map<string, { value: string; expiresAt: number }>()
  const puts: Array<{ key: string; value: string; expirationTtl: number | undefined }> = []
  const state = { rejectPut: false }
  const namespace: RateLimitKvNamespace = {
    async get(key) {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt <= Date.now()) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async put(key, value, options) {
      if (state.rejectPut) throw new Error('KV PUT failed: 429 Too Many Requests')
      puts.push({ key, value, expirationTtl: options?.expirationTtl })
      const ttl = options?.expirationTtl
      store.set(key, {
        value,
        expiresAt: ttl === undefined ? Infinity : Date.now() + ttl * 1000,
      })
    },
    async delete(key) {
      store.delete(key)
    },
  }
  return { namespace, store, puts, state }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createKvRateLimiter', () => {
  it('allows max hits per window and reports what is left', async () => {
    const { namespace } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 3 })

    expect(await limiter.check('k')).toEqual({
      allowed: true,
      remaining: 2,
      resetAt: new Date(START + MINUTE),
    })
    expect((await limiter.check('k')).remaining).toBe(1)
    expect(await limiter.check('k')).toMatchObject({ allowed: true, remaining: 0 })
    expect(await limiter.check('k')).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: new Date(START + MINUTE),
    })
  })

  it('counts keys apart', async () => {
    const { namespace } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 1 })

    expect((await limiter.check('a')).allowed).toBe(true)
    expect((await limiter.check('a')).allowed).toBe(false)
    expect((await limiter.check('b')).allowed).toBe(true)
  })

  it('stores the key under the prefix, with the count and the end of the window', async () => {
    const { namespace, puts } = fakeKv()
    await createKvRateLimiter({ namespace, windowMs: 5 * MINUTE, max: 3 }).check('login:a@b.c')
    await createKvRateLimiter({ namespace, windowMs: 5 * MINUTE, max: 3, prefix: 'rl' }).check('x')

    expect(puts).toEqual([
      {
        key: 'ratelimit:login:a@b.c',
        value: JSON.stringify({ count: 1, resetAt: START + 5 * MINUTE }),
        expirationTtl: 300,
      },
      {
        key: 'rl:x',
        value: JSON.stringify({ count: 1, resetAt: START + 5 * MINUTE }),
        expirationTtl: 300,
      },
    ])
  })

  it('the window ends when it was due: later hits do not push it out', async () => {
    const { namespace, puts } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: 5 * MINUTE, max: 10 })

    await limiter.check('k')
    vi.setSystemTime(START + 2 * MINUTE)
    const second = await limiter.check('k')
    vi.setSystemTime(START + 4 * MINUTE)
    const third = await limiter.check('k')

    // Every hit reports the end the first one set, and the key's expiry shrinks towards it.
    expect(second.resetAt).toEqual(new Date(START + 5 * MINUTE))
    expect(third.resetAt).toEqual(new Date(START + 5 * MINUTE))
    expect(third.remaining).toBe(7)
    expect(puts.map((p) => p.expirationTtl)).toEqual([300, 180, 60])

    vi.setSystemTime(START + 5 * MINUTE)
    expect(await limiter.check('k')).toEqual({
      allowed: true,
      remaining: 9,
      resetAt: new Date(START + 10 * MINUTE),
    })
  })

  it('a steady stream of hits does not keep a key blocked past its window', async () => {
    const { namespace } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: 2 * MINUTE, max: 2 })

    const allowed: boolean[] = []
    for (let second = 0; second < 300; second += 30) {
      vi.setSystemTime(START + second * 1000)
      allowed.push((await limiter.check('k')).allowed)
    }
    // Two per two-minute window: 0:00 and 0:30, then again from 2:00 and from 4:00.
    expect(allowed).toEqual([true, true, false, false, true, true, false, false, true, true])
  })

  it('a hit over the limit writes nothing', async () => {
    const { namespace, puts } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 2 })

    await limiter.check('k')
    await limiter.check('k')
    expect(puts).toHaveLength(2)

    for (let i = 0; i < 5; i++) expect((await limiter.check('k')).allowed).toBe(false)
    expect(puts).toHaveLength(2)
  })

  it('the stored end decides, even while KV still holds the key', async () => {
    const { namespace, store } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: 2 * MINUTE, max: 1 })

    await limiter.check('k')
    // A hit 90 s in is refused and writes nothing; the key's KV expiry is its first, at 2:00.
    vi.setSystemTime(START + 90_000)
    expect((await limiter.check('k')).allowed).toBe(false)

    // KV kept the key past the window (its expiry is at least 60 s): the value says it is over.
    store.get('ratelimit:k')!.expiresAt = Infinity
    vi.setSystemTime(START + 2 * MINUTE)
    expect(await limiter.check('k')).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('never asks KV for an expiry under its 60 second minimum', async () => {
    const { namespace, puts } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 5 })

    await limiter.check('k')
    vi.setSystemTime(START + 59_000)
    await limiter.check('k')
    expect(puts.map((p) => p.expirationTtl)).toEqual([60, 60])
  })

  it('reset deletes the key', async () => {
    const { namespace, store } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 1 })

    await limiter.check('k')
    expect((await limiter.check('k')).allowed).toBe(false)
    await limiter.reset('k')
    expect(store.has('ratelimit:k')).toBe(false)
    expect((await limiter.check('k')).allowed).toBe(true)
  })

  it('refuses a window under 60 seconds', () => {
    const { namespace } = fakeKv()
    expect(() => createKvRateLimiter({ namespace, windowMs: 59_999, max: 5 })).toThrow(
      /windowMs must be at least 60000, got 59999/,
    )
    expect(() => createKvRateLimiter({ namespace, windowMs: Number.NaN, max: 5 })).toThrow(
      /windowMs/,
    )
  })

  it('a value it did not write counts as no window', async () => {
    const { namespace } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 2 })

    for (const value of ['not json', '7', 'null', '{"count":"3"}']) {
      await namespace.put('ratelimit:k', value)
      expect(await limiter.check('k')).toMatchObject({ allowed: true, remaining: 1 })
    }
  })

  it('a write KV refuses rejects the check: the hit is not let through uncounted', async () => {
    const { namespace, state } = fakeKv()
    const limiter = createKvRateLimiter({ namespace, windowMs: MINUTE, max: 5 })

    await limiter.check('k')
    state.rejectPut = true
    await expect(limiter.check('k')).rejects.toThrow(/429/)
  })

  it('answers the same interface as the memory limiter', async () => {
    const memory = createRateLimiter({ windowMs: MINUTE, max: 1 })
    const kv = createKvRateLimiter({ namespace: fakeKv().namespace, windowMs: MINUTE, max: 1 })

    for (const limiter of [memory, kv]) {
      const first = await limiter.check('k')
      expect(first).toEqual({ allowed: true, remaining: 0, resetAt: new Date(START + MINUTE) })
      expect((await limiter.check('k')).allowed).toBe(false)
      await limiter.reset('k')
      expect((await limiter.check('k')).allowed).toBe(true)
    }
  })

  it('accepts the namespace as @cloudflare/workers-types declares it', () => {
    const real = {} as KVNamespace
    const limiter = createKvRateLimiter({ namespace: real, windowMs: MINUTE, max: 1 })
    expect(typeof limiter.check).toBe('function')
  })
})

describe('createSecurity with a KV rate limit', () => {
  it('builds the limiter on the namespace from the config', async () => {
    const { namespace, puts } = fakeKv()
    const security = createSecurity({ rateLimit: { kv: namespace, windowMs: MINUTE, max: 1 } })
    const limiter = security.createRateLimiter()

    expect((await limiter.check('login:a@example.com')).allowed).toBe(true)
    expect((await limiter.check('login:a@example.com')).allowed).toBe(false)
    expect(puts.map((p) => p.key)).toEqual(['ratelimit:login:a@example.com'])
  })

  it('passes the prefix and takes a KV config as a per-call override', async () => {
    const base = fakeKv()
    const other = fakeKv()
    const security = createSecurity({
      rateLimit: { kv: base.namespace, windowMs: MINUTE, max: 1, prefix: 'mail' },
    })

    await security.createRateLimiter().check('k')
    expect(base.puts.map((p) => p.key)).toEqual(['mail:k'])

    await security
      .createRateLimiter({ kv: other.namespace, windowMs: 2 * MINUTE, max: 5 })
      .check('k')
    expect(other.puts.map((p) => p.expirationTtl)).toEqual([120])

    const memory = security.createRateLimiter({ windowMs: MINUTE, max: 2 })
    expect((await memory.check('k')).remaining).toBe(1)
    expect(base.puts).toHaveLength(1)
  })

  it('refuses a window under 60 seconds when the limiter is built', () => {
    const { namespace } = fakeKv()
    const security = createSecurity({ rateLimit: { kv: namespace, windowMs: 10_000, max: 1 } })
    expect(() => security.createRateLimiter()).toThrow(/windowMs must be at least 60000/)
  })

  it('refuses kv next to binding, and a KV limit without window or max', () => {
    const { namespace } = fakeKv()
    const binding = { limit: async () => ({ success: true }) }
    // @ts-expect-error one store per limiter
    createSecurity({ rateLimit: { kv: namespace, binding, windowMs: MINUTE, max: 1 } })
    // @ts-expect-error the KV limiter has no default limit
    createSecurity({ rateLimit: { kv: namespace } })
    // @ts-expect-error the memory limiter takes no namespace
    createRateLimiter({ kv: namespace })
  })
})
