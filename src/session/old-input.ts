import type { SessionData } from './types.js'

const OLD_INPUT_KEY = '__old_input__'
const OLD_INPUT_NEW_KEY = '__old_input_new__'

/**
 * Old-input helpers for re-populating form fields after a validation failure.
 *
 * Call `flashInput(data, formData)` before redirecting, then
 * `getOldInput(data, field)` in the next request to restore values.
 *
 * The "new" buffer is promoted to "old" via `rotateOldInput()` at request start.
 */

export function flashInput(data: SessionData, input: Record<string, unknown>): void {
  data[OLD_INPUT_NEW_KEY] = { ...input }
}

export function getOldInput<T = unknown>(data: SessionData, key: string): T | undefined {
  const bucket = data[OLD_INPUT_KEY] as Record<string, unknown> | undefined
  return bucket?.[key] as T | undefined
}

/** Move `__old_input_new__` to `__old_input__`. Call at the start of each request. */
export function rotateOldInput(data: SessionData): void {
  data[OLD_INPUT_KEY] = (data[OLD_INPUT_NEW_KEY] as Record<string, unknown>) ?? {}
  delete data[OLD_INPUT_NEW_KEY]
}
