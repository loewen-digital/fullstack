/**
 * SvelteKit adapter for @loewen-digital/fullstack.
 *
 * Usage in hooks.server.ts:
 *
 *   import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
 *   import { stack } from '$lib/server/stack'
 *
 *   export const handle = createHandle(stack)
 *
 * Or with sequence():
 *
 *   import { sequence } from '@sveltejs/kit/hooks'
 *   export const handle = sequence(createHandle(stack), myOtherHandle)
 */

import type { SvelteKitHandle, SvelteKitRequestEvent } from './types.js'
import type { SessionManager, SessionHandle } from '../../session/index.js'
import type { AuthInstance, AuthSession } from '../../auth/index.js'
import type { SecurityInstance } from '../../security/index.js'

export type { FullstackLocals, SvelteKitHandle, SvelteKitRequestEvent, SvelteKitCookies } from './types.js'

// The minimal stack shape the adapter requires.
// Users can pass any StackModules-compatible object; only the present modules are used.
export interface AdapterStack {
  session?: SessionManager
  auth?: AuthInstance
  security?: SecurityInstance
}

export interface HandleOptions {
  /**
   * Cookie name used to store the session ID (for memory/redis drivers).
   * Default: 'fsid'
   */
  sessionCookie?: string

  /**
   * Cookie name used to store the auth token.
   * Default: 'fs_token'
   */
  authCookie?: string

  /**
   * Routes that bypass CSRF protection (in addition to GET/HEAD/OPTIONS).
   * Use when you have specific POST endpoints that are public API (e.g. webhooks).
   */
  csrfExempt?: string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Create a SvelteKit Handle function from a fullstack stack.
 *
 * What it does per request:
 *  1. Loads the session (if session module configured) → event.locals.session
 *  2. Reads auth token from cookie → validates session → event.locals.authSession, event.locals.user
 *  3. Enforces CSRF for non-GET mutations (if security module configured)
 *  4. Saves the session after the route resolves
 */
export function createHandle(stack: AdapterStack, options: HandleOptions = {}): SvelteKitHandle {
  const sessionCookie = options.sessionCookie ?? 'fsid'
  const authCookie = options.authCookie ?? 'fs_token'
  const csrfExempt = new Set(options.csrfExempt ?? [])

  return async ({ event, resolve }) => {
    // ── 1. Load session ────────────────────────────────────────────────────
    let sessionHandle: SessionHandle | undefined

    if (stack.session) {
      const sessionId = event.cookies.get(sessionCookie)
      sessionHandle = await stack.session.load(sessionId)
      event.locals.session = sessionHandle
    }

    // ── 2. Validate auth token ─────────────────────────────────────────────
    if (stack.auth) {
      const token = event.cookies.get(authCookie)
      let authSession: AuthSession | null = null

      if (token) {
        authSession = await stack.auth.validateSession(token)
      }

      event.locals.authSession = authSession
      event.locals.user = null // populated below if session valid

      if (authSession) {
        // The auth module doesn't expose findUserById directly.
        // We expose the raw session; the app can look up the user from its own DB.
        event.locals.user = { id: authSession.userId, email: '' }
      }
    }

    // ── 3. CSRF check for mutating requests ────────────────────────────────
    if (stack.security && !SAFE_METHODS.has(event.request.method)) {
      const routeId = event.route?.id ?? ''

      // Skip CSRF for explicitly exempt routes
      const isExempt = csrfExempt.has(routeId)

      if (!isExempt) {
        // Look for CSRF token in the request headers or form body
        const csrfToken =
          event.request.headers.get('x-csrf-token') ??
          event.request.headers.get('x-xsrf-token') ??
          null

        const sessionId = sessionHandle?.id ?? event.cookies.get(sessionCookie) ?? ''
        let csrfVerified = false

        if (csrfToken && sessionId) {
          csrfVerified = await stack.security.verifyCsrfToken(sessionId, csrfToken)
        }

        event.locals.csrfVerified = csrfVerified
      } else {
        event.locals.csrfVerified = true
      }
    }

    // ── 4. Resolve the request ─────────────────────────────────────────────
    const response = await resolve(event)

    // ── 5. Persist the session (save any changes made during the request) ──
    if (sessionHandle) {
      await sessionHandle.save()

      // Set the session cookie if it's a new session or was regenerated
      const currentId = sessionHandle.id
      const existingId = event.cookies.get(sessionCookie)

      if (currentId !== existingId) {
        event.cookies.set(sessionCookie, currentId, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: event.url.protocol === 'https:',
        })
      }
    }

    return response
  }
}

/**
 * Helper: get the CSRF token for the current session.
 * Use in form actions to embed the token in a hidden field.
 *
 * Usage (SvelteKit form action or server load):
 *   const csrf = await getCsrfToken(locals, security)
 */
export async function getCsrfToken(
  locals: { session?: SessionHandle },
  security: SecurityInstance,
): Promise<string> {
  const sessionId = locals.session?.id ?? crypto.randomUUID()
  return security.generateCsrfToken(sessionId)
}

/**
 * Helper: validate request data with flash-on-failure support.
 * On validation failure, flashes errors and old input to session.
 *
 * Usage in a form action:
 *   const result = await validateForm(request, locals.session, {
 *     name: 'required|string|max:255',
 *     email: 'required|email',
 *   })
 *   if (!result.ok) return fail(422, { errors: result.errors })
 */
export async function validateForm<Rules extends Record<string, unknown>>(
  request: Request,
  session: SessionHandle | undefined,
  rules: Rules,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; errors: unknown[] }> {
  const { validate } = await import('../../validation/index.js')

  const contentType = request.headers.get('content-type') ?? ''
  let data: Record<string, unknown>

  if (contentType.includes('application/json')) {
    data = (await request.json()) as Record<string, unknown>
  } else {
    const form = await request.formData()
    data = Object.fromEntries(form as unknown as Iterable<[string, FormDataEntryValue]>)
  }

  const result = await validate(data, rules as Parameters<typeof validate>[1])

  if (!result.ok && session) {
    session.flash('_errors', result.errors)
    session.flashInput(data)
  }

  return result
}

/**
 * Helper: set an auth cookie after successful login.
 */
export function setAuthCookie(
  event: SvelteKitRequestEvent,
  token: string,
  options: { maxAge?: number; authCookie?: string } = {},
): void {
  const cookieName = options.authCookie ?? 'fs_token'
  event.cookies.set(cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:',
    maxAge: options.maxAge ?? 7 * 24 * 3600, // 7 days
  })
}

/**
 * Helper: clear the auth cookie on logout.
 */
export function clearAuthCookie(
  event: SvelteKitRequestEvent,
  options: { authCookie?: string } = {},
): void {
  const cookieName = options.authCookie ?? 'fs_token'
  event.cookies.delete(cookieName, { path: '/' })
}
