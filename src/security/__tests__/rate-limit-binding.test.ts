import { describe, it, expect } from 'vitest'
import type { RateLimit } from '@cloudflare/workers-types'
import { createBindingRateLimiter, createRateLimiter, createSecurity } from '../index.js'
import type { RateLimitBinding } from '../index.js'

/** A Rate Limiting binding in memory: `limit` hits per key, no window, records every call */
function fakeBinding(limit: number): { binding: RateLimitBinding; calls: string[] } {
  const counts = new Map<string, number>()
  const calls: string[] = []
  return {
    calls,
    binding: {
      async limit({ key }) {
        calls.push(key)
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return { success: count <= limit }
      },
    },
  }
}

describe('createBindingRateLimiter', () => {
  it('reports allowed from the binding, asked with the key', async () => {
    const { binding, calls } = fakeBinding(2)
    const limiter = createBindingRateLimiter({ binding })

    expect((await limiter.check('user:1')).allowed).toBe(true)
    expect((await limiter.check('user:1')).allowed).toBe(true)
    expect((await limiter.check('user:1')).allowed).toBe(false)
    expect((await limiter.check('user:2')).allowed).toBe(true)
    expect(calls).toEqual(['user:1', 'user:1', 'user:1', 'user:2'])
  })

  it('invents no count and no reset time', async () => {
    const { binding } = fakeBinding(1)
    const limiter = createBindingRateLimiter({ binding })

    const allowed = await limiter.check('k')
    const blocked = await limiter.check('k')
    expect(allowed).toEqual({ allowed: true })
    expect(blocked).toEqual({ allowed: false })
    expect('remaining' in blocked).toBe(false)
    expect('resetAt' in blocked).toBe(false)
  })

  it('reset does nothing: the binding has no reset', async () => {
    const { binding, calls } = fakeBinding(1)
    const limiter = createBindingRateLimiter({ binding })

    await limiter.check('k')
    await limiter.reset('k')
    expect(calls).toEqual(['k'])
    expect((await limiter.check('k')).allowed).toBe(false)
  })

  it('answers the same interface as the memory limiter', async () => {
    const memory = createRateLimiter({ windowMs: 60_000, max: 1 })
    const bound = createBindingRateLimiter(fakeBinding(1))

    for (const limiter of [memory, bound]) {
      expect((await limiter.check('k')).allowed).toBe(true)
      expect((await limiter.check('k')).allowed).toBe(false)
      await limiter.reset('k')
    }
    const counted = await memory.check('k')
    expect(counted.remaining).toBe(0)
    expect(counted.resetAt).toBeInstanceOf(Date)
  })

  it('accepts the binding as @cloudflare/workers-types declares it', () => {
    const real = {} as RateLimit
    const limiter = createBindingRateLimiter({ binding: real })
    expect(typeof limiter.check).toBe('function')
  })

  it('refuses windowMs and max next to the binding', () => {
    const { binding } = fakeBinding(1)
    // @ts-expect-error the binding's limit lives in wrangler, not in max
    createSecurity({ rateLimit: { binding, max: 5 } })
    // @ts-expect-error the memory limiter takes no binding
    createRateLimiter({ binding })
  })
})

describe('createSecurity with a rate limit binding', () => {
  it('builds the limiter on the binding from the config', async () => {
    const { binding, calls } = fakeBinding(1)
    const security = createSecurity({ rateLimit: { binding } })
    const limiter = security.createRateLimiter()

    expect(await limiter.check('login:a@example.com')).toEqual({ allowed: true })
    expect(await limiter.check('login:a@example.com')).toEqual({ allowed: false })
    expect(calls).toEqual(['login:a@example.com', 'login:a@example.com'])
  })

  it('takes a memory config or another binding as a per-call override', async () => {
    const base = fakeBinding(1)
    const other = fakeBinding(3)
    const security = createSecurity({ rateLimit: { binding: base.binding } })

    const memory = security.createRateLimiter({ windowMs: 60_000, max: 2 })
    expect((await memory.check('k')).remaining).toBe(1)
    expect(base.calls).toEqual([])

    const bound = security.createRateLimiter({ binding: other.binding })
    await bound.check('k')
    expect(other.calls).toEqual(['k'])
    expect(base.calls).toEqual([])
  })
})
