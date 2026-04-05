/**
 * Remix adapter for @loewen-digital/fullstack.
 *
 * Remix uses a loader/action pattern — there is no persistent server middleware.
 * Instead, this adapter provides wrapper functions that enrich the args object
 * with session, auth, and CSRF data before calling your loader or action.
 *
 * Usage:
 *
 *   // app/lib/fullstack.server.ts
 *   import { createRemixLoader, createRemixAction } from '@loewen-digital/fullstack/adapters/remix'
 *   import { stack } from '~/lib/stack.server'
 *
 *   export const loader = createRemixLoader(stack)
 *   export const action = createRemixAction(stack)
 *
 *   // app/routes/dashboard.tsx
 *   import { loader as wrapLoader } from '~/lib/fullstack.server'
 *
 *   export const loader = wrapLoader(async (args) => {
 *     const { session, user } = args
 *     return json({ user })
 *   })
 */

import type { SessionHandle } from '../../session/index.js'
import type { SessionManager } from '../../session/index.js'
import type { AuthInstance, AuthSession } from '../../auth/index.js'
import type { SecurityInstance } from '../../security/index.js'
import type {
  RemixFunctionArgs,
  FullstackRemixArgs,
  FullstackLoaderFunction,
  FullstackActionFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from './types.js'

export type {
  RemixFunctionArgs,
  RemixParams,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  FullstackRemixArgs,
  FullstackLoaderFunction,
  FullstackActionFunction,
} from './types.js'

// ── Stack shape ────────────────────────────────────────────────────────────────

export interface AdapterStack {
  session?: SessionManager
  auth?: AuthInstance
  security?: SecurityInstance
}

export interface RemixAdapterOptions {
  /**
   * Cookie name used to store the session ID.
   * Default: 'fsid'
   */
  sessionCookie?: string

  /**
   * Cookie name used to store the auth token.
   * Default: 'fs_token'
   */
  authCookie?: string

  /**
   * Paths that bypass CSRF protection.
   * Default: []
   */
  csrfExemptPaths?: string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// ── Cookie helpers (Web Standards — no Node dep) ───────────────────────────────

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const name = part.slice(0, eqIdx).trim()
    const value = part.slice(eqIdx + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
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

function getRequestCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  return parseCookies(header)[name]
}

// ── Core: build the enriched args ─────────────────────────────────────────────

async function buildFullstackArgs(
  args: RemixFunctionArgs,
  stack: AdapterStack,
  options: Required<RemixAdapterOptions>,
): Promise<{ fsArgs: FullstackRemixArgs; sessionHandle?: SessionHandle }> {
  const { request } = args
  const { sessionCookie, authCookie, csrfExemptPaths } = options

  // 1. Load session
  let sessionHandle: SessionHandle | undefined
  if (stack.session) {
    const sessionId = getRequestCookie(request, sessionCookie)
    sessionHandle = await stack.session.load(sessionId)
  }

  // 2. Auth validation
  let authSession: AuthSession | null = null
  let user: FullstackRemixArgs['user'] = null
  if (stack.auth) {
    const token = getRequestCookie(request, authCookie)
    if (token) {
      authSession = await stack.auth.validateSession(token)
    }
    user = authSession ? { id: authSession.userId, email: '' } : null
  }

  // 3. CSRF check
  let csrfVerified: boolean | undefined
  if (stack.security && !SAFE_METHODS.has(request.method.toUpperCase())) {
    const url = new URL(request.url)
    const isExempt = csrfExemptPaths.some((p) => url.pathname.startsWith(p))

    if (isExempt) {
      csrfVerified = true
    } else {
      const csrfToken =
        request.headers.get('x-csrf-token') ??
        request.headers.get('x-xsrf-token') ??
        null

      const sessionId = sessionHandle?.id ?? getRequestCookie(request, sessionCookie) ?? ''
      csrfVerified = false

      if (csrfToken && sessionId) {
        csrfVerified = await stack.security.verifyCsrfToken(sessionId, csrfToken)
      }
    }
  }

  // Build commitSession helper
  async function commitSession(): Promise<string> {
    if (!sessionHandle) return ''
    await sessionHandle.save()
    return serializeCookie(sessionCookie, sessionHandle.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(request.url).protocol === 'https:',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })
  }

  const fsArgs: FullstackRemixArgs = {
    ...args,
    session: sessionHandle,
    ...(stack.auth ? { authSession, user } : {}),
    ...(csrfVerified !== undefined ? { csrfVerified } : {}),
    commitSession,
  }

  return { fsArgs, sessionHandle }
}

// ── Wrapper factories ──────────────────────────────────────────────────────────

/**
 * Create a factory that wraps Remix loader functions with fullstack context.
 *
 * Returns a function that accepts your loader and returns a standard Remix loader.
 *
 * Usage:
 *   const withFullstack = createRemixLoader(stack)
 *   export const loader = withFullstack(async ({ session, user }) => { ... })
 */
export function createRemixLoader(stack: AdapterStack, options: RemixAdapterOptions = {}) {
  const opts: Required<RemixAdapterOptions> = {
    sessionCookie: options.sessionCookie ?? 'fsid',
    authCookie: options.authCookie ?? 'fs_token',
    csrfExemptPaths: options.csrfExemptPaths ?? [],
  }

  return function wrapLoader<T>(handler: FullstackLoaderFunction<T>) {
    return async function loader(args: LoaderFunctionArgs): Promise<T> {
      const { fsArgs } = await buildFullstackArgs(args, stack, opts)
      return handler(fsArgs)
    }
  }
}

/**
 * Create a factory that wraps Remix action functions with fullstack context.
 *
 * Usage:
 *   const withFullstack = createRemixAction(stack)
 *   export const action = withFullstack(async ({ session, csrfVerified }) => { ... })
 */
export function createRemixAction(stack: AdapterStack, options: RemixAdapterOptions = {}) {
  const opts: Required<RemixAdapterOptions> = {
    sessionCookie: options.sessionCookie ?? 'fsid',
    authCookie: options.authCookie ?? 'fs_token',
    csrfExemptPaths: options.csrfExemptPaths ?? [],
  }

  return function wrapAction<T>(handler: FullstackActionFunction<T>) {
    return async function action(args: ActionFunctionArgs): Promise<T> {
      const { fsArgs } = await buildFullstackArgs(args, stack, opts)
      return handler(fsArgs)
    }
  }
}

/**
 * Lower-level: build fullstack args for a single request.
 * Useful when you want finer control or want to share logic between loader and action.
 */
export async function withFullstack(
  args: RemixFunctionArgs,
  stack: AdapterStack,
  options: RemixAdapterOptions = {},
): Promise<FullstackRemixArgs> {
  const opts: Required<RemixAdapterOptions> = {
    sessionCookie: options.sessionCookie ?? 'fsid',
    authCookie: options.authCookie ?? 'fs_token',
    csrfExemptPaths: options.csrfExemptPaths ?? [],
  }
  const { fsArgs } = await buildFullstackArgs(args, stack, opts)
  return fsArgs
}

// ── Cookie helpers for responses ───────────────────────────────────────────────

/**
 * Build a Set-Cookie header string for the auth token.
 * Pass the result in your Response headers.
 *
 * Example:
 *   return new Response(null, {
 *     headers: { 'Set-Cookie': authCookieHeader('my-token') }
 *   })
 */
export function authCookieHeader(
  token: string,
  options: { maxAge?: number; authCookie?: string; secure?: boolean } = {},
): string {
  return serializeCookie(options.authCookie ?? 'fs_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: options.secure ?? false,
    maxAge: options.maxAge ?? 7 * 24 * 3600,
  })
}

/**
 * Build a Set-Cookie header string that clears the auth token.
 */
export function clearAuthCookieHeader(options: { authCookie?: string } = {}): string {
  return serializeCookie(options.authCookie ?? 'fs_token', '', {
    path: '/',
    maxAge: 0,
  })
}

/**
 * Generate a CSRF token for the current session context.
 * Use in loaders to return a token the form can embed.
 */
export async function getCsrfToken(
  fsArgs: Pick<FullstackRemixArgs, 'session'>,
  security: SecurityInstance,
): Promise<string> {
  const sessionId = fsArgs.session?.id ?? crypto.randomUUID()
  return security.generateCsrfToken(sessionId)
}

/**
 * Validate request body (JSON or form-encoded) with flash-on-failure support.
 *
 * On validation failure, errors and old input are flashed to the session.
 * Remember to call commitSession() in your response headers.
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
