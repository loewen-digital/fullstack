import type { SessionConfig } from '../config/types.js'
import type { SessionDriver, SessionHandle, SessionManager, SessionData } from './types.js'
import { flash, getFlash, rotateFlash } from './flash.js'
import { flashInput, getOldInput, rotateOldInput } from './old-input.js'
import { createMemoryDriver } from './drivers/memory.js'
import { createCookieDriver } from './drivers/cookie.js'

export type { SessionDriver, SessionHandle, SessionManager, SessionData }
export type { SessionConfig } from '../config/types.js'
export { rotateFlash } from './flash.js'
export { rotateOldInput } from './old-input.js'
export { createMemoryDriver } from './drivers/memory.js'
export { createCookieDriver } from './drivers/cookie.js'
export { createRedisDriver } from './drivers/redis.js'

/**
 * Create a session manager.
 *
 * Usage:
 *   const session = createSession({ driver: 'memory' })
 *   const handle = await session.load(existingSessionId)
 *   handle.set('userId', 42)
 *   await handle.save()
 */
export function createSession(config: SessionConfig): SessionManager {
  const ttlSeconds = parseTtl(config.maxAge ?? '2h')

  let driver: SessionDriver

  if (config.driver === 'memory') {
    driver = createMemoryDriver(ttlSeconds)
  } else if (config.driver === 'cookie') {
    driver = createCookieDriver(config.secret ?? 'change-me', ttlSeconds)
  } else if (config.driver === 'redis') {
    throw new Error(
      'Redis session driver requires a Redis client. ' +
        'Import createRedisDriver from @loewen-digital/fullstack/session and pass your client.',
    )
  } else {
    throw new Error(`Unknown session driver: "${config.driver}"`)
  }

  return createSessionManager(driver, ttlSeconds)
}

/**
 * Low-level factory: create a session manager from any SessionDriver.
 * Use this when you need to supply a custom or pre-configured driver.
 */
export function createSessionManager(driver: SessionDriver, ttlSeconds = 7200): SessionManager {
  return {
    driver,

    async load(sessionId?: string): Promise<SessionHandle> {
      const id = sessionId ?? driver.generateId()
      const data: SessionData = await driver.read(id)

      // Promote flash + old input from previous request
      rotateFlash(data)
      rotateOldInput(data)

      let currentId = id

      const handle: SessionHandle = {
        get id() {
          return currentId
        },

        get<T = unknown>(key: string): T | undefined {
          return data[key] as T | undefined
        },

        set(key: string, value: unknown): void {
          data[key] = value
        },

        forget(key: string): void {
          delete data[key]
        },

        async regenerate(): Promise<void> {
          await driver.destroy(currentId)
          currentId = driver.generateId()
        },

        async destroy(): Promise<void> {
          await driver.destroy(currentId)
        },

        async save(): Promise<void> {
          await driver.write(currentId, data, ttlSeconds)
        },

        flash(key: string, value: unknown): void {
          flash(data, key, value)
        },

        getFlash<T = unknown>(key: string): T | undefined {
          return getFlash<T>(data, key)
        },

        flashInput(input: Record<string, unknown>): void {
          flashInput(data, input)
        },

        getOldInput<T = unknown>(key: string): T | undefined {
          return getOldInput<T>(data, key)
        },
      }

      return handle
    },
  }
}

/** Parse a human-readable duration string into seconds. */
function parseTtl(value: string): number {
  const match = /^(\d+)(s|m|h|d)?$/.exec(value)
  if (!match) return 7200
  const num = parseInt(match[1], 10)
  const unit = match[2] ?? 's'
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return num * (multipliers[unit] ?? 1)
}
