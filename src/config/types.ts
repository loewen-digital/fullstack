// FullstackConfig — master config type
// Each module config is optional; only configured modules are instantiated.

export interface DbConfig {
  driver: 'sqlite' | 'postgres' | 'mysql' | 'd1'
  url: string
  migrations?: string
  seeds?: string
}

/**
 * Auth module config.
 * All TTL values are in seconds.
 */
export interface AuthConfig {
  /** Session TTL in seconds (default: 7 days = 604800) */
  sessionTtl?: number
  /** Token TTL in seconds for email verification (default: 24 hours = 86400) */
  emailVerificationTtl?: number
  /** Token TTL in seconds for password reset (default: 1 hour = 3600) */
  passwordResetTtl?: number
}

export interface MailConfig {
  driver: 'console' | 'smtp' | 'resend' | 'postmark' | string
  from?: string
  templates?: string
  silent?: boolean
  [key: string]: unknown
}

export interface StorageConfig {
  driver: 'local' | 's3' | 'r2' | 'memory' | string
  basePath?: string
  [key: string]: unknown
}

export interface CacheConfig {
  driver: 'memory' | 'redis' | 'kv' | string
  ttl?: string
  [key: string]: unknown
}

export interface QueueConfig {
  driver: 'memory' | 'redis' | 'cloudflare' | string
  [key: string]: unknown
}

export interface SecurityConfig {
  csrf?: boolean | { secret?: string }
  cors?: {
    origins?: string[]
    [key: string]: unknown
  }
  rateLimit?: {
    windowMs?: string
    max?: number
  }
}

export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  transport?: 'console' | 'file' | string
  format?: 'dev' | 'prod'
  [key: string]: unknown
}

export interface SessionConfig {
  driver: 'cookie' | 'memory' | 'redis' | string
  maxAge?: string
  secret?: string
  [key: string]: unknown
}

export interface I18nConfig {
  defaultLocale: string
  locales: string[]
  directory?: string
}

export interface NotificationsConfig {
  channels?: {
    sms?: unknown
    push?: unknown
  }
}

export interface PermissionsConfig {
  /** Pre-defined roles to register on creation */
  roles?: Array<{
    name: string
    permissions: string[]
    inherits?: string[]
  }>
}

export interface SearchConfig {
  driver: 'sqlite-fts' | 'meilisearch' | 'typesense' | string
  /** For sqlite-fts: path to the SQLite database (default: ':memory:') */
  url?: string
  /** For meilisearch/typesense: base URL of the service */
  host?: string
  /** API key for Meilisearch or Typesense */
  apiKey?: string
  [key: string]: unknown
}

export interface WebhooksConfig {
  /** Default signing secret for outgoing webhooks */
  secret?: string
  /** Maximum number of delivery retries */
  maxRetries?: number
  /** Initial retry delay in ms */
  retryDelay?: number
}

export interface RealtimeConfig {
  /** Default ping interval in ms (WebSocket keepalive) */
  pingInterval?: number
}

export interface FullstackConfig {
  db?: DbConfig
  auth?: AuthConfig
  mail?: MailConfig
  storage?: StorageConfig
  cache?: CacheConfig
  queue?: QueueConfig
  security?: SecurityConfig
  logging?: LoggingConfig
  session?: SessionConfig
  i18n?: I18nConfig
  notifications?: NotificationsConfig
  search?: SearchConfig
  webhooks?: WebhooksConfig
  realtime?: RealtimeConfig
  permissions?: PermissionsConfig
}
