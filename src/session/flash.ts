import type { SessionData } from './types.js'

const FLASH_KEY = '__flash__'
const FLASH_NEW_KEY = '__flash_new__'

/**
 * Flash helpers that operate on a mutable session data object.
 *
 * Flash values are written to `__flash_new__` and moved to `__flash__`
 * at the start of the next request (by calling `rotateFlash`).
 */

export function flash(data: SessionData, key: string, value: unknown): void {
  const current = (data[FLASH_NEW_KEY] as Record<string, unknown>) ?? {}
  current[key] = value
  data[FLASH_NEW_KEY] = current
}

export function getFlash<T = unknown>(data: SessionData, key: string): T | undefined {
  const bucket = data[FLASH_KEY] as Record<string, unknown> | undefined
  return bucket?.[key] as T | undefined
}

/** Move `__flash_new__` to `__flash__`. Call at the start of each request. */
export function rotateFlash(data: SessionData): void {
  data[FLASH_KEY] = (data[FLASH_NEW_KEY] as Record<string, unknown>) ?? {}
  delete data[FLASH_NEW_KEY]
}
