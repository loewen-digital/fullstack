/**
 * createStack — initializes all configured modules and wires inter-module dependencies.
 *
 * Usage:
 *   const stack = createStack({
 *     db: { driver: 'sqlite', url: './app.db' },
 *     mail: { driver: 'console' },
 *     cache: { driver: 'memory' },
 *   })
 *   // TypeScript infers: stack.db, stack.mail, stack.cache — nothing else
 *
 * Auth requires a DB adapter (it's schema-agnostic):
 *   const stack = createStack({ auth: {}, db: { ... } }, { authDb: myAdapter })
 */

import type {
  FullstackConfig,
  AuthConfig,
  LoggingConfig,
  PermissionsConfig,
  SearchConfig,
  WebhooksConfig,
  RealtimeConfig,
} from '../config/types.js'
import type { SecurityConfig as SecurityModuleConfig } from '../security/types.js'
import type { NotificationsConfig as NotificationsModuleConfig } from '../notifications/types.js'
import type { DbInstance } from '../db/index.js'
import type { AuthInstance, AuthDbAdapter } from '../auth/index.js'
import type { MailInstance } from '../mail/index.js'
import type { StorageInstance } from '../storage/index.js'
import type { CacheInstance } from '../cache/index.js'
import type { QueueInstance } from '../queue/index.js'
import type { SecurityInstance } from '../security/index.js'
import type { LoggerInstance } from '../logging/index.js'
import type { SessionManager } from '../session/index.js'
import type { I18nInstance } from '../i18n/index.js'
import type { NotificationsInstance } from '../notifications/index.js'
import type { PermissionsInstance } from '../permissions/index.js'
import type { SearchInstance } from '../search/index.js'
import type { WebhooksInstance } from '../webhooks/index.js'
import type { RealtimeInstance } from '../realtime/index.js'

import { createDb } from '../db/index.js'
import { createAuth } from '../auth/index.js'
import { createMail } from '../mail/index.js'
import { createStorage } from '../storage/index.js'
import { createCache } from '../cache/index.js'
import { createQueue } from '../queue/index.js'
import { createSecurity } from '../security/index.js'
import { createLogger } from '../logging/index.js'
import { createSession } from '../session/index.js'
import { createI18n } from '../i18n/index.js'
import { createNotifications } from '../notifications/index.js'
import { createPermissions } from '../permissions/index.js'
import { createSearch } from '../search/index.js'
import { createWebhooks } from '../webhooks/index.js'
import { createRealtime } from '../realtime/index.js'
import { ConfigError } from '../errors/index.js'

// ── Type inference ─────────────────────────────────────────────────────────────
// For each config key, if it's present in C (not undefined), include the module
// in the return type. This gives full TypeScript inference.

type IfPresent<T, V> = undefined extends T ? Record<never, never> : V

export type StackModules<C extends FullstackConfig> =
  IfPresent<C['db'],          { db: DbInstance }> &
  IfPresent<C['auth'],        { auth: AuthInstance }> &
  IfPresent<C['mail'],        { mail: MailInstance }> &
  IfPresent<C['storage'],     { storage: StorageInstance }> &
  IfPresent<C['cache'],       { cache: CacheInstance }> &
  IfPresent<C['queue'],       { queue: QueueInstance }> &
  IfPresent<C['security'],    { security: SecurityInstance }> &
  IfPresent<C['logging'],     { logging: LoggerInstance }> &
  IfPresent<C['session'],     { session: SessionManager }> &
  IfPresent<C['i18n'],        { i18n: I18nInstance }> &
  IfPresent<C['notifications'], { notifications: NotificationsInstance }> &
  IfPresent<C['permissions'], { permissions: PermissionsInstance }> &
  IfPresent<C['search'],      { search: SearchInstance }> &
  IfPresent<C['webhooks'],    { webhooks: WebhooksInstance }> &
  IfPresent<C['realtime'],    { realtime: RealtimeInstance }>

export interface StackDeps {
  /**
   * DB adapter for the auth module.
   * Required when `config.auth` is present.
   * Implement the AuthDbAdapter interface against your Drizzle schema.
   */
  authDb?: AuthDbAdapter
}

export function createStack<C extends FullstackConfig>(
  config: C,
  deps: StackDeps = {},
): StackModules<C> {
  const stack: Record<string, unknown> = {}

  // ── 1. Standalone, no dependencies ─────────────────────────────────────────

  if (config.logging !== undefined) {
    const logCfg = config.logging as LoggingConfig
    stack.logging = createLogger({
      level: logCfg.level,
      format: logCfg.format,
    })
  }

  if (config.db !== undefined) {
    stack.db = createDb(config.db)
  }

  if (config.cache !== undefined) {
    stack.cache = createCache(config.cache)
  }

  if (config.session !== undefined) {
    stack.session = createSession(config.session)
  }

  if (config.mail !== undefined) {
    stack.mail = createMail(config.mail)
  }

  if (config.storage !== undefined) {
    stack.storage = createStorage(config.storage)
  }

  if (config.queue !== undefined) {
    stack.queue = createQueue(config.queue)
  }

  if (config.security !== undefined) {
    stack.security = createSecurity(config.security as SecurityModuleConfig)
  }

  if (config.i18n !== undefined) {
    stack.i18n = createI18n(config.i18n)
  }

  if (config.permissions !== undefined) {
    const permCfg = config.permissions as PermissionsConfig
    stack.permissions = createPermissions(permCfg)
  }

  if (config.search !== undefined) {
    const searchCfg = config.search as SearchConfig
    stack.search = createSearch(searchCfg as SearchConfig)
  }

  if (config.webhooks !== undefined) {
    const webhooksCfg = config.webhooks as WebhooksConfig
    stack.webhooks = createWebhooks(webhooksCfg)
  }

  if (config.realtime !== undefined) {
    const realtimeCfg = config.realtime as RealtimeConfig
    stack.realtime = createRealtime(realtimeCfg)
  }

  // ── 2. Modules with inter-module dependencies ───────────────────────────────

  // Auth depends on an AuthDbAdapter (schema-agnostic interface).
  if (config.auth !== undefined) {
    if (!deps.authDb) {
      throw new ConfigError(
        'auth requires a DB adapter. ' +
        'Pass { authDb: myAdapter } as the second argument to createStack().\n' +
        'The AuthDbAdapter interface maps auth operations to your Drizzle schema.',
      )
    }
    const authCfg = config.auth as AuthConfig
    stack.auth = createAuth(authCfg, { db: deps.authDb })
  }

  // Notifications optionally depends on mail.
  if (config.notifications !== undefined) {
    stack.notifications = createNotifications(config.notifications as NotificationsModuleConfig, {
      mail: stack.mail as MailInstance | undefined,
    })
  }

  return stack as StackModules<C>
}
