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
  kv?: never
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
  kv?: never
}

/** The slice of a Cloudflare KV namespace the KV limiter calls: `env.MY_KV` in a Worker or a Pages Function */
export interface RateLimitKvNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/** The limiter on a KV namespace: a fixed window whose count every isolate shares, eventually */
export interface RateLimitKvConfig {
  namespace: RateLimitKvNamespace
  /** Time window in milliseconds, 60_000 at the least: KV keeps no key for less */
  windowMs: number
  /** Max hits per window */
  max: number
  /** Prefix of the keys in the namespace (default: 'ratelimit'); a key is stored as `prefix:key` */
  prefix?: string
}

/** `rateLimit` of the security config for the KV limiter: `kv` is the namespace */
export interface RateLimitKvSecurityConfig extends Omit<RateLimitKvConfig, 'namespace'> {
  kv: RateLimitKvNamespace
  binding?: never
}

/** What `createSecurity` builds a limiter from: in memory, on the binding or on KV */
export type SecurityRateLimitConfig =
  | RateLimitConfig
  | RateLimitBindingConfig
  | RateLimitKvSecurityConfig

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
  rateLimit?: SecurityRateLimitConfig
}

export interface SecurityInstance {
  /** Generate a CSRF token for the given session id */
  generateCsrfToken(sessionId: string): Promise<string>
  /** Verify a CSRF token against the session id */
  verifyCsrfToken(sessionId: string, token: string): Promise<boolean>
  /** Compute CORS headers for the given origin */
  corsHeaders(origin: string | null, config?: CorsConfig): Headers
  /**
   * Create a rate limiter: in memory, on the Rate Limiting binding when the config carries
   * `binding`, on a KV namespace when it carries `kv`
   */
  createRateLimiter(config?: SecurityRateLimitConfig): RateLimiter
  /** Strip dangerous HTML/scripts from a string */
  sanitize(input: string): string
}
