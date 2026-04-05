/**
 * Nuxt adapter for @loewen-digital/fullstack.
 *
 * Usage in server/middleware/fullstack.ts:
 *
 *   import { createNuxtMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
 *   import { stack } from '~/server/stack'
 *
 *   export default createNuxtMiddleware(stack)
 *
 * The middleware populates event.context with session, authSession, user, and csrfVerified.
 * Access them in API routes and server middleware via event.context.session, etc.
 */

import type { SessionHandle } from '../../session/index.js'
import type { SessionManager } from '../../session/index.js'
import type { AuthInstance, AuthSession } from '../../auth/index.js'
import type { SecurityInstance } from '../../security/index.js'
import type { H3Event, H3EventHandler, FullstackNuxtContext } from './types.js'

export type { FullstackNuxtContext, H3Event, H3EventHandler, H3CookieOptions, NitroMiddleware } from './types.js'

// ── Stack shape ────────────────────────────────────────────────────────────────

export interface AdapterStack {
  session?: SessionManager
  auth?: AuthInstance
  security?: SecurityInstance
}

export interface NuxtMiddlewareOptions {
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
   * URL path prefixes that bypass CSRF protection.
   * Useful for webhook endpoints that POST without a CSRF token.
   * Default: []
   */
  csrfExemptPaths?: string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ── Cookie helpers (work without importing h3) ─────────────────────────────────

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.split('=')
    const name = rawName?.trim()
    if (!name) continue
    cookies[name] = decodeURIComponent(rest.join('=').trim())
  }
  return cookies
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: string
    path?: string
    maxAge?: number
  } = {},
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`
  if (options.path) cookie += `; Path=${options.path}`
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`
  if (options.httpOnly) cookie += '; HttpOnly'
  if (options.secure) cookie += '; Secure'
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  return cookie
}

function getRequestCookie(event: H3Event, name: string): string | undefined {
  const header = event.node?.req.headers['cookie']
  if (!header) return undefined
  const raw = Array.isArray(header) ? header.join('; ') : header
  return parseCookies(raw)[name]
}

function setResponseCookie(
  event: H3Event,
  name: string,
  value: string,
  options: { httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number } = {},
): void {
  const serialized = serializeCookie(name, value, options)
  const existing = event.node?.res.getHeader('Set-Cookie')
  const cookies = existing
    ? Array.isArray(existing)
      ? [...existing, serialized]
      : [existing as string, serialized]
    : [serialized]
  event.node?.res.setHeader('Set-Cookie', cookies.join(', '))
}

function deleteResponseCookie(event: H3Event, name: string): void {
  setResponseCookie(event, name, '', { maxAge: 0, path: '/' })
}

function getRequestMethod(event: H3Event): string {
  return (event.method ?? event.node?.req.method ?? 'GET').toUpperCase()
}

function getRequestHeader(event: H3Event, name: string): string | undefined {
  const val = event.node?.req.headers[name.toLowerCase()]
  return Array.isArray(val) ? val[0] : val
}

function getRequestPath(event: H3Event): string {
  return event.path ?? event.node?.req.url ?? '/'
}

// ── Main middleware factory ─────────────────────────────────────────────────────

/**
 * Create a Nitro server middleware from a fullstack stack.
 *
 * What it does per request:
 *  1. Loads session (if session module configured) → event.context.session
 *  2. Validates auth token from cookie → event.context.authSession, event.context.user
 *  3. Enforces CSRF for non-GET mutations (if security module configured)
 */
export function createNuxtMiddleware(stack: AdapterStack, options: NuxtMiddlewareOptions = {}): H3EventHandler<void> {
  const sessionCookie = options.sessionCookie ?? 'fsid'
  const authCookie = options.authCookie ?? 'fs_token'
  const csrfExemptPaths = options.csrfExemptPaths ?? []

  return async (event: H3Event): Promise<void> => {
    // ── 1. Load session ──────────────────────────────────────────────────────
    let sessionHandle: SessionHandle | undefined

    if (stack.session) {
      const sessionId = getRequestCookie(event, sessionCookie)
      sessionHandle = await stack.session.load(sessionId)
      ;(event.context as FullstackNuxtContext).session = sessionHandle
    }

    // ── 2. Validate auth token ───────────────────────────────────────────────
    if (stack.auth) {
      const token = getRequestCookie(event, authCookie)
      let authSession: AuthSession | null = null

      if (token) {
        authSession = await stack.auth.validateSession(token)
      }

      const ctx = event.context as FullstackNuxtContext
      ctx.authSession = authSession
      ctx.user = authSession ? { id: authSession.userId, email: '' } : null
    }

    // ── 3. CSRF check ────────────────────────────────────────────────────────
    if (stack.security && !SAFE_METHODS.has(getRequestMethod(event))) {
      const path = getRequestPath(event)
      const isExempt = csrfExemptPaths.some((p) => path.startsWith(p))

      if (!isExempt) {
        const csrfToken =
          getRequestHeader(event, 'x-csrf-token') ??
          getRequestHeader(event, 'x-xsrf-token') ??
          null

        const sessionId = sessionHandle?.id ?? getRequestCookie(event, sessionCookie) ?? ''
        let csrfVerified = false

        if (csrfToken && sessionId) {
          csrfVerified = await stack.security.verifyCsrfToken(sessionId, csrfToken)
        }

        ;(event.context as FullstackNuxtContext).csrfVerified = csrfVerified
      } else {
        ;(event.context as FullstackNuxtContext).csrfVerified = true
      }
    }

    // ── 4. Persist session ───────────────────────────────────────────────────
    if (sessionHandle) {
      await sessionHandle.save()

      const existingId = getRequestCookie(event, sessionCookie)
      if (sessionHandle.id !== existingId) {
        setResponseCookie(event, sessionCookie, sessionHandle.id, {
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
          // secure only if we can detect HTTPS — Nitro apps should set this themselves
        })
      }
    }
  }
}

// ── Convenience helpers ────────────────────────────────────────────────────────

/**
 * Generate a CSRF token for the current session.
 * Use in API routes to return a token that the frontend can send in subsequent requests.
 */
export async function getCsrfToken(
  context: FullstackNuxtContext,
  security: SecurityInstance,
): Promise<string> {
  const sessionId = context.session?.id ?? crypto.randomUUID()
  return security.generateCsrfToken(sessionId)
}

/**
 * Set the auth cookie in the response (e.g. after login).
 */
export function setAuthCookie(
  event: H3Event,
  token: string,
  options: { maxAge?: number; authCookie?: string; secure?: boolean } = {},
): void {
  const cookieName = options.authCookie ?? 'fs_token'
  setResponseCookie(event, cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: options.secure ?? false,
    maxAge: options.maxAge ?? 7 * 24 * 3600,
  })
}

/**
 * Clear the auth cookie on logout.
 */
export function clearAuthCookie(event: H3Event, options: { authCookie?: string } = {}): void {
  const cookieName = options.authCookie ?? 'fs_token'
  deleteResponseCookie(event, cookieName)
}

/**
 * Validate request body (JSON or form) with flash-on-failure support.
 */
export async function validateBody<Rules extends Record<string, unknown>>(
  event: H3Event,
  rules: Rules,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; errors: unknown[] }> {
  const { validate } = await import('../../validation/index.js')

  // Read raw body from node request
  const body = await readBody(event)

  const result = await validate(body, rules as Parameters<typeof validate>[1])

  if (!result.ok) {
    const ctx = event.context as FullstackNuxtContext
    if (ctx.session) {
      ctx.session.flash('_errors', result.errors)
      ctx.session.flashInput(body)
    }
  }

  return result
}

async function readBody(event: H3Event): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const req = event.node?.req
    if (!req) {
      resolve({})
      return
    }

    let data = ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeReq = req as any
    nodeReq.on?.('data', (chunk: Buffer | string) => {
      data += chunk.toString()
    })
    nodeReq.on?.('end', () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>)
      } catch {
        // Try form-encoded
        try {
          const params = new URLSearchParams(data)
          resolve(Object.fromEntries(params))
        } catch {
          resolve({})
        }
      }
    })
    nodeReq.on?.('error', () => resolve({}))

    // If already buffered (Nitro may pre-read)
    if (!nodeReq.on) {
      resolve({})
    }
  })
}
