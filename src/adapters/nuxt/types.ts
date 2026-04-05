/**
 * Nuxt/Nitro adapter type definitions.
 *
 * These mirror the Nitro/h3 public API without requiring them as dependencies.
 * The adapter is compatible via structural typing.
 */

import type { SessionHandle } from '../../session/index.js'
import type { AuthSession, AuthUser } from '../../auth/index.js'

// ── Minimal h3/Nitro-compatible types ─────────────────────────────────────────

export interface H3EventContext {
  [key: string]: unknown
  /** Populated by the fullstack middleware */
  session?: SessionHandle
  authSession?: AuthSession | null
  user?: AuthUser | null
  csrfVerified?: boolean
}

export interface H3CookieOptions {
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  path?: string
  domain?: string
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none' | boolean
}

export interface H3Event {
  /** The underlying Web Request (Nitro uses Web Standard Request) */
  node?: {
    req: {
      method?: string
      url?: string
      headers: Record<string, string | string[] | undefined>
    }
    res: {
      statusCode: number
      setHeader(name: string, value: string): void
      getHeader(name: string): string | string[] | undefined
    }
  }
  /** H3 context bag — fullstack stores session, user, etc. here */
  context: H3EventContext
  /** Web standard request (Nitro ≥ 2.x) */
  _handled?: boolean
  /** Internal path */
  path?: string
  /** HTTP method */
  method?: string
}

/** A Nitro/h3 event handler function */
export type H3EventHandler<T = unknown> = (event: H3Event) => T | Promise<T>

/** A Nitro server middleware — same signature but typically returns void */
export type NitroMiddleware = H3EventHandler<void | undefined>

// ── Fullstack context extension ────────────────────────────────────────────────

export interface FullstackNuxtContext {
  /**
   * The session handle for the current request.
   * Available when session module is configured.
   */
  session?: SessionHandle

  /**
   * The authenticated session for the current request.
   */
  authSession?: AuthSession | null

  /**
   * The authenticated user (basic shape; app should enrich from DB).
   */
  user?: AuthUser | null

  /**
   * Whether CSRF verification passed for mutating requests.
   */
  csrfVerified?: boolean
}
