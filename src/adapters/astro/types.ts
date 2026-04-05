/**
 * Astro adapter type definitions.
 *
 * These mirror Astro's public middleware/API route API without requiring it as a dependency.
 * The adapter is compatible via structural typing.
 */

import type { SessionHandle } from '../../session/index.js'
import type { AuthSession, AuthUser } from '../../auth/index.js'

// ── Minimal Astro-compatible types ─────────────────────────────────────────────

export interface AstroCookieSetOptions {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'strict' | 'lax' | 'none' | boolean
  secure?: boolean
}

export interface AstroCookies {
  get(key: string): { value: string | undefined } | undefined
  has(key: string): boolean
  set(key: string, value: string, options?: AstroCookieSetOptions): void
  delete(key: string, options?: Pick<AstroCookieSetOptions, 'domain' | 'path'>): void
  headers(): string[]
}

export interface AstroLocals {
  [key: string]: unknown
  /** Populated by fullstack middleware */
  session?: SessionHandle
  authSession?: AuthSession | null
  user?: AuthUser | null
  csrfVerified?: boolean
}

/**
 * Astro APIContext — passed to API route handlers and middleware.
 */
export interface AstroAPIContext {
  request: Request
  url: URL
  params: Record<string, string | undefined>
  locals: AstroLocals
  cookies: AstroCookies
  site?: URL | undefined
  generator?: string
}

/**
 * Astro middleware "next" function — calls the next middleware or route handler.
 */
export type AstroMiddlewareNext = () => Promise<Response>

/**
 * An Astro middleware function.
 */
export type AstroMiddleware = (
  context: AstroAPIContext,
  next: AstroMiddlewareNext,
) => Promise<Response>

// ── Fullstack context extension ────────────────────────────────────────────────

export interface FullstackAstroLocals {
  /**
   * The session handle for the current request.
   * Available when session module is configured.
   */
  session?: SessionHandle

  /**
   * The authenticated session.
   */
  authSession?: AuthSession | null

  /**
   * The authenticated user.
   */
  user?: AuthUser | null

  /**
   * Whether CSRF verification passed for mutating requests.
   */
  csrfVerified?: boolean
}
