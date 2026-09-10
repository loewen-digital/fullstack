import type { SecurityConfig, SecurityInstance, CorsConfig, RateLimitConfig } from './types.js'
import { generateCsrfToken, verifyCsrfToken } from './csrf.js'
import { corsHeaders } from './cors.js'
import { createRateLimiter } from './rate-limit.js'
import { sanitize } from './sanitize.js'

export type { SecurityConfig, SecurityInstance, CorsConfig, RateLimitConfig }
export type { RateLimiter, RateLimitResult } from './types.js'
export { corsHeaders } from './cors.js'
export { createRateLimiter } from './rate-limit.js'
export { sanitize, escapeHtml } from './sanitize.js'
export { generateCsrfToken, verifyCsrfToken } from './csrf.js'

/**
 * Create a security utilities instance.
 *
 * Usage:
 *   const security = createSecurity({ csrf: { secret: 'my-secret' } })
 *   const token = await security.generateCsrfToken(sessionId)
 *   const valid = await security.verifyCsrfToken(sessionId, token)
 */
export function createSecurity(config: SecurityConfig = {}): SecurityInstance {
  // CSRF tokens are HMACs over the session id; without a secret of your own they are forgeable.
  const csrfSecret = typeof config.csrf === 'object' && config.csrf !== null ? config.csrf.secret : undefined

  function requireCsrfSecret(): string {
    if (!csrfSecret) {
      throw new Error('CSRF tokens need a secret: createSecurity({ csrf: { secret } }).')
    }
    return csrfSecret
  }

  const defaultCorsConfig: CorsConfig = config.cors ?? {}
  const defaultRateLimitConfig: RateLimitConfig = config.rateLimit ?? {}

  return {
    async generateCsrfToken(sessionId: string): Promise<string> {
      return generateCsrfToken(sessionId, requireCsrfSecret())
    },

    async verifyCsrfToken(sessionId: string, token: string): Promise<boolean> {
      return verifyCsrfToken(sessionId, token, requireCsrfSecret())
    },

    corsHeaders(origin: string | null, overrideConfig?: CorsConfig): Headers {
      return corsHeaders(origin, overrideConfig ?? defaultCorsConfig)
    },

    createRateLimiter(overrideConfig?: RateLimitConfig) {
      return createRateLimiter(overrideConfig ?? defaultRateLimitConfig)
    },

    sanitize(input: string): string {
      return sanitize(input)
    },
  }
}
