/**
 * Type-safe environment variable access with fallbacks.
 *
 * env('DATABASE_URL')           — required, throws if missing
 * env('PORT', '3000')           — optional with default
 * env('DEBUG', false)           — typed as boolean
 * env('MAX_CONNECTIONS', 10)    — typed as number
 */
export function env(key: string): string
export function env(key: string, fallback: string): string
export function env(key: string, fallback: number): number
export function env(key: string, fallback: boolean): boolean
export function env(key: string, fallback?: string | number | boolean): string | number | boolean {
  const raw = (typeof process !== 'undefined' ? process.env[key] : undefined) ?? undefined

  if (raw === undefined) {
    if (fallback === undefined) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
    return fallback
  }

  if (typeof fallback === 'number') {
    const n = Number(raw)
    if (Number.isNaN(n)) throw new Error(`Environment variable ${key} must be a number, got: ${raw}`)
    return n
  }

  if (typeof fallback === 'boolean') {
    const lower = raw.toLowerCase()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0') return false
    throw new Error(`Environment variable ${key} must be a boolean (true/false/1/0), got: ${raw}`)
  }

  return raw
}
