export interface CsrfConfig {
  secret: string
}

export interface CorsConfig {
  origins?: string[] | '*'
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

/** The in-memory limiter: a fixed window per process, per isolate on Cloudflare Workers */
export interface RateLimitConfig {
  /** Time window in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number
  /** Max requests per window (default: 60) */
  max?: number
  binding?: never
}

/** The slice of Cloudflare's Rate Limiting binding the limiter calls: `env.MY_LIMITER` in a Worker */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** The limiter on the Rate Limiting binding; its limit and period are wrangler's, not `windowMs` and `max` */
export interface RateLimitBindingConfig {
  binding: RateLimitBinding
  windowMs?: never
  max?: never
}

export interface RateLimitResult {
  allowed: boolean
  /** Hits left in the window; absent where the store does not count, the binding answers yes or no */
  remaining?: number
  /** When the window ends; absent where the store does not report it */
  resetAt?: Date
}

export interface RateLimiter {
  /** Count one hit for `key` and report whether it stayed within the limit */
  check(key: string): Promise<RateLimitResult>
  /** Forget `key`. The binding has no reset: there this does nothing, the counter runs out with its period */
  reset(key: string): Promise<void>
}

export interface SecurityConfig {
  csrf?: CsrfConfig | boolean
  cors?: CorsConfig
  rateLimit?: RateLimitConfig | RateLimitBindingConfig
}

export interface SecurityInstance {
  /** Generate a CSRF token for the given session id */
  generateCsrfToken(sessionId: string): Promise<string>
  /** Verify a CSRF token against the session id */
  verifyCsrfToken(sessionId: string, token: string): Promise<boolean>
  /** Compute CORS headers for the given origin */
  corsHeaders(origin: string | null, config?: CorsConfig): Headers
  /** Create a rate limiter: in memory, or on the Rate Limiting binding when the config carries one */
  createRateLimiter(config?: RateLimitConfig | RateLimitBindingConfig): RateLimiter
  /** Strip dangerous HTML/scripts from a string */
  sanitize(input: string): string
}
