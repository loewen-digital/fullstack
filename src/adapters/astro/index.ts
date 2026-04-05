/**
 * Astro adapter for @loewen-digital/fullstack.
 *
 * Usage in src/middleware.ts:
 *
 *   import { sequence } from 'astro:middleware'
 *   import { createAstroMiddleware } from '@loewen-digital/fullstack/adapters/astro'
 *   import { stack } from './lib/stack'
 *
 *   export const onRequest = sequence(createAstroMiddleware(stack))
 *
 * The middleware populates Astro.locals with session, authSession, user, and csrfVerified.
 * Access in .astro files and API routes via Astro.locals / context.locals.
 *
 * To extend the Locals type, add to src/env.d.ts:
 *
 *   /// <reference types="astro/client" />
 *   import type { FullstackAstroLocals } from '@loewen-digital/fullstack/adapters/astro'
 *   declare namespace App {
 *     interface Locals extends FullstackAstroLocals {}
 *   }
 */

import type { SessionHandle } from '../../session/index.js'
import type { SessionManager } from '../../session/index.js'
import type { AuthInstance, AuthSession } from '../../auth/index.js'
import type { SecurityInstance } from '../../security/index.js'
import type {
  AstroAPIContext,
  AstroMiddlewareNext,
  AstroMiddleware,
  FullstackAstroLocals,
} from './types.js'

export type {
  AstroAPIContext,
  AstroMiddleware,
  AstroMiddlewareNext,
  AstroCookies,
  AstroCookieSetOptions,
  AstroLocals,
  FullstackAstroLocals,
} from './types.js'

// ── Stack shape ────────────────────────────────────────────────────────────────

export interface AdapterStack {
  session?: SessionManager
  auth?: AuthInstance
  security?: SecurityInstance
}

export interface AstroMiddlewareOptions {
  /**
   * Cookie name used to store the session ID (memory/redis drivers).
   * Default: 'fsid'
   */
  sessionCookie?: string

  /**
   * Cookie name used to store the auth token.
   * Default: 'fs_token'
   */
  authCookie?: string

  /**
   * URL path prefixes that bypass CSRF protection.
   * Default: []
   */
  csrfExemptPaths?: string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ── Main middleware factory ─────────────────────────────────────────────────────

/**
 * Create an Astro middleware function from a fullstack stack.
 *
 * Per request:
 *  1. Loads session → context.locals.session
 *  2. Validates auth token → context.locals.authSession, context.locals.user
 *  3. Enforces CSRF for non-GET mutations
 *  4. Persists session after the route handler resolves
 */
export function createAstroMiddleware(
  stack: AdapterStack,
  options: AstroMiddlewareOptions = {},
): AstroMiddleware {
  const sessionCookie = options.sessionCookie ?? 'fsid'
  const authCookie = options.authCookie ?? 'fs_token'
  const csrfExemptPaths = options.csrfExemptPaths ?? []

  return async (context: AstroAPIContext, next: AstroMiddlewareNext): Promise<Response> => {
    const { request, url, cookies, locals } = context

    // ── 1. Load session ────────────────────────────────────────────────────
    let sessionHandle: SessionHandle | undefined

    if (stack.session) {
      const sessionId = cookies.get(sessionCookie)?.value
      sessionHandle = await stack.session.load(sessionId)
      ;(locals as FullstackAstroLocals).session = sessionHandle
    }

    // ── 2. Validate auth token ─────────────────────────────────────────────
    if (stack.auth) {
      const token = cookies.get(authCookie)?.value
      let authSession: AuthSession | null = null

      if (token) {
        authSession = await stack.auth.validateSession(token)
      }

      const loc = locals as FullstackAstroLocals
      loc.authSession = authSession
      loc.user = authSession ? { id: authSession.userId, email: '' } : null
    }

    // ── 3. CSRF check ──────────────────────────────────────────────────────
    if (stack.security && !SAFE_METHODS.has(request.method.toUpperCase())) {
      const isExempt = csrfExemptPaths.some((p) => url.pathname.startsWith(p))

      if (isExempt) {
        ;(locals as FullstackAstroLocals).csrfVerified = true
      } else {
        const csrfToken =
          request.headers.get('x-csrf-token') ??
          request.headers.get('x-xsrf-token') ??
          null

        const sessionId = sessionHandle?.id ?? cookies.get(sessionCookie)?.value ?? ''
        let csrfVerified = false

        if (csrfToken && sessionId) {
          csrfVerified = await stack.security.verifyCsrfToken(sessionId, csrfToken)
        }

        ;(locals as FullstackAstroLocals).csrfVerified = csrfVerified
      }
    }

    // ── 4. Resolve the request ─────────────────────────────────────────────
    const response = await next()

    // ── 5. Persist session ─────────────────────────────────────────────────
    if (sessionHandle) {
      await sessionHandle.save()

      const existingId = cookies.get(sessionCookie)?.value
      if (sessionHandle.id !== existingId) {
        cookies.set(sessionCookie, sessionHandle.id, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: url.protocol === 'https:',
        })
      }
    }

    return response
  }
}

// ── Convenience helpers ────────────────────────────────────────────────────────

/**
 * Generate a CSRF token for the current session.
 * Use in API routes or page endpoints to return a token the form can send.
 */
export async function getCsrfToken(
  locals: FullstackAstroLocals,
  security: SecurityInstance,
): Promise<string> {
  const sessionId = locals.session?.id ?? crypto.randomUUID()
  return security.generateCsrfToken(sessionId)
}

/**
 * Set the auth cookie in the response (e.g. after login).
 */
export function setAuthCookie(
  context: AstroAPIContext,
  token: string,
  options: { maxAge?: number; authCookie?: string } = {},
): void {
  const cookieName = options.authCookie ?? 'fs_token'
  context.cookies.set(cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
    maxAge: options.maxAge ?? 7 * 24 * 3600,
  })
}

/**
 * Clear the auth cookie on logout.
 */
export function clearAuthCookie(
  context: AstroAPIContext,
  options: { authCookie?: string } = {},
): void {
  const cookieName = options.authCookie ?? 'fs_token'
  context.cookies.delete(cookieName, { path: '/' })
}

/**
 * Validate request body (JSON or form-encoded) with flash support.
 * Flashes errors and old input to session on failure.
 */
export async function validateBody<Rules extends Record<string, unknown>>(
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
