/**
 * SvelteKit adapter types.
 *
 * The adapter has no runtime dependency on `@sveltejs/kit`. It types only the parts of
 * SvelteKit's `RequestEvent` and `Handle` it touches, in a shape SvelteKit's own types
 * fit structurally under `strict: true`. `__tests__/kit-types.test.ts` checks that
 * against `@sveltejs/kit`.
 *
 * Import this file in your app.d.ts to extend App.Locals:
 *
 *   /// <reference types="@loewen-digital/fullstack/adapters/sveltekit" />
 *
 * Or manually declare:
 *
 *   import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'
 *   declare global {
 *     namespace App {
 *       interface Locals extends FullstackLocals {}
 *     }
 *   }
 */

import type { SessionHandle } from '../../session/index.js'
import type { AuthSession, AuthUser } from '../../auth/index.js'

export interface FullstackLocals {
  /**
   * The session handle for the current request.
   * Available when session module is configured.
   */
  session?: SessionHandle

  /**
   * The authenticated session for the current request.
   * Available when auth module is configured and the request is authenticated.
   */
  authSession?: AuthSession | null

  /**
   * The authenticated user for the current request.
   * Populated when auth module is configured and a valid session token is present.
   */
  user?: AuthUser | null

  /**
   * Whether the current request has passed CSRF verification.
   * Populated when security module is configured with CSRF enabled.
   */
  csrfVerified?: boolean
}

// ── The slice of SvelteKit the adapter uses ───────────────────────────────────
// Members are method signatures on purpose: TypeScript checks their parameters
// bivariantly, so SvelteKit's `Cookies` and `resolve`, which take SvelteKit's full
// types, stay assignable under `strictFunctionTypes`.

/**
 * Cookie options the adapter passes to `cookies.set` and `cookies.delete`:
 * a subset of the `cookie` package's serialize options plus SvelteKit's required `path`.
 */
export interface SvelteKitCookieOptions {
  path: string
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  sameSite?: boolean | 'lax' | 'strict' | 'none'
  secure?: boolean
}

/** The part of SvelteKit's `Cookies` the adapter uses. */
export interface SvelteKitCookies {
  get(name: string): string | undefined
  set(name: string, value: string, opts: SvelteKitCookieOptions): void
  delete(name: string, opts: SvelteKitCookieOptions): void
}

/** The part of SvelteKit's `RequestEvent` the adapter uses. */
export interface SvelteKitRequestEvent {
  request: Request
  url: URL
  /**
   * `App.Locals` of the app. Any interface fits, index signature or not;
   * the adapter narrows it to `FullstackLocals` when it writes.
   */
  locals: object
  cookies: SvelteKitCookies
  route: { id: string | null }
}

/** The part of SvelteKit's `ResolveOptions` the adapter forwards. */
export interface SvelteKitResolveOptions {
  transformPageChunk?(input: { html: string; done: boolean }): string | undefined | Promise<string | undefined>
  filterSerializedResponseHeaders?(name: string, value: string): boolean
  preload?(input: { type: string; path: string }): boolean
}

/** The argument SvelteKit passes to a `Handle`. */
export interface SvelteKitHandleInput {
  event: SvelteKitRequestEvent
  resolve(event: SvelteKitRequestEvent, opts?: SvelteKitResolveOptions): Response | Promise<Response>
}

export type SvelteKitResolve = SvelteKitHandleInput['resolve']

/** Structurally a SvelteKit `Handle`; assignable to it and usable in `sequence()`. */
export type SvelteKitHandle = (input: SvelteKitHandleInput) => Promise<Response>
