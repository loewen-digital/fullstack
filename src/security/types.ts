export interface CsrfConfig {
  secret: string
  /** Token expiry in seconds (default: 7200 = 2 hours) */
  ttl?: number
}

export interface CorsConfig {
  origins?: string[] | '*'
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

export interface RateLimitConfig {
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number
  /** Max requests per window (default: 60) */
  max?: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export interface RateLimiter {
  check(key: string): RateLimitResult
  reset(key: string): void
}

export interface SecurityConfig {
  csrf?: CsrfConfig | boolean
  cors?: CorsConfig
  rateLimit?: RateLimitConfig
}

export interface SecurityInstance {
  /** Generate a CSRF token for the given session id */
  generateCsrfToken(sessionId: string): Promise<string>
  /** Verify a CSRF token against the session id */
  verifyCsrfToken(sessionId: string, token: string): Promise<boolean>
  /** Compute CORS headers for the given origin */
  corsHeaders(origin: string | null, config?: CorsConfig): Headers
  /** Create an in-memory rate limiter */
  createRateLimiter(config?: RateLimitConfig): RateLimiter
  /** Strip dangerous HTML/scripts from a string */
  sanitize(input: string): string
}
