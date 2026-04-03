// FullstackConfig — master config type
// Each module config is optional; only configured modules are instantiated.

export interface DbConfig {
  driver: 'sqlite' | 'postgres' | 'mysql' | 'd1'
  url: string
  migrations?: string
  seeds?: string
}

export interface AuthConfig {
  providers?: Array<'credentials' | 'google' | 'github' | string>
  session?: {
    driver: 'cookie' | 'memory' | 'redis'
    maxAge?: string
    secret?: string
  }
  passwords?: {
    reset?: boolean
    minLength?: number
  }
  emailVerification?: boolean
}

export interface MailConfig {
  driver: 'console' | 'smtp' | 'resend' | 'postmark' | string
  from?: string
  templates?: string
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
  csrf?: boolean
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
}
