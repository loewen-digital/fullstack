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
  const csrfSecret =
    typeof config.csrf === 'object' && config.csrf !== null
      ? config.csrf.secret
      : 'default-csrf-secret-change-me'

  const defaultCorsConfig: CorsConfig = config.cors ?? {}
  const defaultRateLimitConfig: RateLimitConfig = config.rateLimit ?? {}

  return {
    async generateCsrfToken(sessionId: string): Promise<string> {
      return generateCsrfToken(sessionId, csrfSecret)
    },

    async verifyCsrfToken(sessionId: string, token: string): Promise<boolean> {
      return verifyCsrfToken(sessionId, token, csrfSecret)
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
