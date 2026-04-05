/**
 * Remix adapter type definitions.
 *
 * These mirror Remix's public loader/action API without requiring it as a dependency.
 * The adapter is compatible via structural typing.
 */

import type { SessionHandle } from '../../session/index.js'
import type { AuthSession, AuthUser } from '../../auth/index.js'

// ── Minimal Remix-compatible types ─────────────────────────────────────────────

export interface RemixParams {
  [key: string]: string | undefined
}

/**
 * The arguments passed to a Remix loader or action function.
 * Mirrors Remix's LoaderFunctionArgs / ActionFunctionArgs.
 */
export interface RemixFunctionArgs {
  request: Request
  params: RemixParams
  context?: Record<string, unknown>
}

export type LoaderFunctionArgs = RemixFunctionArgs
export type ActionFunctionArgs = RemixFunctionArgs

/** A Remix loader function */
export type LoaderFunction<T = unknown> = (args: LoaderFunctionArgs) => T | Promise<T>

/** A Remix action function */
export type ActionFunction<T = unknown> = (args: ActionFunctionArgs) => T | Promise<T>

// ── Fullstack context for Remix ────────────────────────────────────────────────

/**
 * The enriched args object passed into fullstack-wrapped loaders/actions.
 * Extends RemixFunctionArgs with session, auth, and CSRF data.
 */
export interface FullstackRemixArgs extends RemixFunctionArgs {
  /** The session handle, if session module is configured. */
  session?: SessionHandle

  /** The authenticated session, if auth module is configured and token is valid. */
  authSession?: AuthSession | null

  /** The authenticated user (basic shape; enrich from DB as needed). */
  user?: AuthUser | null

  /** Whether CSRF verification passed for mutating requests. */
  csrfVerified?: boolean

  /**
   * Commit the session and return the Set-Cookie header value.
   * Call this inside your loader/action and include the result
   * in a `headers` object on your Response to persist session changes.
   *
   * Example:
   *   const cookie = await fsArgs.commitSession()
   *   return json(data, { headers: { 'Set-Cookie': cookie } })
   */
  commitSession(): Promise<string>
}

/** A fullstack-enhanced loader function */
export type FullstackLoaderFunction<T = unknown> = (args: FullstackRemixArgs) => T | Promise<T>

/** A fullstack-enhanced action function */
export type FullstackActionFunction<T = unknown> = (args: FullstackRemixArgs) => T | Promise<T>
