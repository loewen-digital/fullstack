/**
 * SvelteKit adapter type augmentation.
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

// ── Minimal SvelteKit-compatible types ────────────────────────────────────────
// These mirror @sveltejs/kit's public API without requiring it as a dep.
// The adapter is compatible with SvelteKit's Handle type via structural typing.

export interface SvelteKitCookies {
  get(name: string, opts?: { decode?: (v: string) => string }): string | undefined
  getAll(opts?: { decode?: (v: string) => string }): Array<{ name: string; value: string }>
  set(name: string, value: string, opts?: Record<string, unknown>): void
  delete(name: string, opts?: Record<string, unknown>): void
  serialize(name: string, value: string, opts?: Record<string, unknown>): string
}

export interface SvelteKitRequestEvent {
  request: Request
  url: URL
  params: Record<string, string>
  locals: Record<string, unknown>
  cookies: SvelteKitCookies
  route: { id: string | null }
}

export type SvelteKitResolve = (
  event: SvelteKitRequestEvent,
  opts?: {
    transformPageChunk?: (opts: { html: string; done: boolean }) => string | undefined | Promise<string | undefined>
    filterSerializedResponseHeaders?: (name: string, value: string) => boolean
    preload?: (opts: { type: string; path: string }) => boolean
  },
) => Promise<Response>

export type SvelteKitHandle = (input: {
  event: SvelteKitRequestEvent
  resolve: SvelteKitResolve
}) => Promise<Response>
