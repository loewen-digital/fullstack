import type { RateLimitBindingConfig, RateLimiter, RateLimitResult } from './types.js'

/**
 * A rate limiter on Cloudflare's Rate Limiting binding, for a Worker: the count lives outside the
 * isolate, the limit and its period (10 or 60 s) in the binding's wrangler config. `check` reports
 * `allowed` and nothing else, the binding tells no count and no reset time; `reset` does nothing,
 * the binding has no reset. The count is per Cloudflare location and eventually consistent.
 *
 * Usage:
 *   const limiter = createBindingRateLimiter({ binding: env.LOGIN_LIMITER })
 *   const { allowed } = await limiter.check(`login:${email}`)
 */
export function createBindingRateLimiter(config: RateLimitBindingConfig): RateLimiter {
  const { binding } = config

  return {
    async check(key: string): Promise<RateLimitResult> {
      const { success } = await binding.limit({ key })
      return { allowed: success }
    },

    async reset(): Promise<void> {},
  }
}
