import type { FullstackConfig } from './types.js'

export type { FullstackConfig }
export type {
  DbConfig,
  AuthConfig,
  MailConfig,
  StorageConfig,
  CacheConfig,
  QueueConfig,
  SecurityConfig,
  LoggingConfig,
  SessionConfig,
  I18nConfig,
} from './types.js'
export { env } from './env.js'
export { resolveDriver } from './drivers.js'

/**
 * Typed config builder — validates shape at the TypeScript level and
 * returns the config unchanged (thin wrapper for IDE autocomplete).
 */
export function defineConfig(config: FullstackConfig): FullstackConfig {
  return config
}

/**
 * Loads fullstack.config.ts from the project root at runtime.
 * Falls back to an empty config if no file is found.
 *
 * Note: dynamic import of user config files requires the consuming
 * project to call this at startup (e.g. from the Vite plugin or CLI).
 * In tests, pass config directly to createStack() instead.
 */
export async function loadConfig(root?: string): Promise<FullstackConfig> {
  const base = root ?? (typeof process !== 'undefined' ? process.cwd() : '')
  const paths = [
    `${base}/fullstack.config.ts`,
    `${base}/fullstack.config.js`,
  ]

  for (const path of paths) {
    try {
      const mod = await import(path) as { default?: FullstackConfig }
      if (mod.default) return mod.default
    } catch {
      // file not found — try next path
    }
  }

  return {}
}
