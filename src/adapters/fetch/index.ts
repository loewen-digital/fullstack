/**
 * Fetch adapter for @loewen-digital/fullstack: auth for plain fetch handlers, where no framework
 * hook runs (Cloudflare Pages Functions, bare Workers, Hono, Deno, Bun).
 *
 * Usage in a Pages Function middleware:
 *
 *   import { createFetchAdapter, isSecureRequest } from '@loewen-digital/fullstack/adapters/fetch'
 *
 *   export const onRequest: PagesFunction<Env> = async (context) => {
 *     const adapter = createFetchAdapter({ auth }, { secure: isSecureRequest(context.request) })
 *     const { session, clearCookie } = await adapter.sessionOf(context.request)
 *     context.data.authSession = session
 *     ...
 *   }
 */

import { parseCookies, serializeCookie } from '../cookies.js'
import type {
  FetchAdapterInstance,
  FetchAdapterOptions,
  FetchAdapterStack,
  FetchSessionResult,
} from './types.js'

export type {
  FetchAdapterInstance,
  FetchAdapterOptions,
  FetchAdapterStack,
  FetchAuthCookieOptions,
  FetchSessionResult,
} from './types.js'

const SAME_SITE = { lax: 'Lax', strict: 'Strict', none: 'None' } as const

/**
 * Create the auth helpers for fetch handlers from an auth instance.
 *
 * The auth cookie is written like the SvelteKit adapter writes it: `HttpOnly`, `Path=/`,
 * `SameSite=Lax`, 7 days. `Secure` is on unless `secure` says otherwise: the helpers that write a
 * cookie get response headers, not the request, so they cannot tell HTTPS from HTTP themselves.
 */
export function createFetchAdapter(
  stack: FetchAdapterStack,
  options: FetchAdapterOptions = {},
): FetchAdapterInstance {
  const { auth } = stack
  const authCookie = options.authCookie ?? 'fs_token'
  const sameSite = SAME_SITE[options.sameSite ?? 'lax']
  const maxAge = options.maxAge ?? 7 * 24 * 3600

  function cookie(value: string, age: number, secure: boolean | undefined): string {
    return serializeCookie(authCookie, value, {
      path: '/',
      maxAge: age,
      httpOnly: true,
      secure: secure ?? options.secure ?? true,
      sameSite,
    })
  }

  return {
    async sessionOf(request: Request): Promise<FetchSessionResult> {
      const header = request.headers.get('cookie')
      const token = header ? parseCookies(header)[authCookie] : undefined
      if (!token) return { session: null, clearCookie: null }

      const session = await auth.validateSession(token)
      if (session) return { session, clearCookie: null }
      // Here the request is at hand, so the deleting cookie matches its scheme.
      return { session: null, clearCookie: cookie('', 0, isSecureRequest(request)) }
    },

    setAuthCookie(headers, token, overrides = {}): void {
      headers.append('Set-Cookie', cookie(token, overrides.maxAge ?? maxAge, overrides.secure))
    },

    clearAuthCookie(headers, overrides = {}): void {
      headers.append('Set-Cookie', cookie('', 0, overrides.secure))
    },
  }
}

/**
 * Whether a request is provably from the app's own origin: the CSRF guard for JSON APIs that
 * carry no form token.
 *
 * `Origin`, which browsers send on every request that is not a GET or HEAD, has to equal the
 * origin of the request URL or one of `allowed` (`https://app.example.com`, as the browser sends
 * it). Without `Origin`, `Sec-Fetch-Site` has to be `same-origin` or `none` (the user typed the
 * URL; no site sent the request). A request with neither header is not from a current browser
 * and answers `false`.
 *
 * Behind a proxy that rewrites the URL, the request's own origin is the internal one: list the
 * public origin in `allowed`.
 */
export function isSameOrigin(request: Request, allowed: readonly string[] = []): boolean {
  const origin = request.headers.get('origin')
  if (origin !== null) {
    return origin === new URL(request.url).origin || allowed.includes(origin)
  }

  const site = request.headers.get('sec-fetch-site')
  return site === 'same-origin' || site === 'none'
}

/**
 * HTTPS or not: the scheme of the request URL, or the first `x-forwarded-proto` value when a
 * proxy terminates TLS in front of the handler. For the `secure` option, so the auth cookie
 * works over plain HTTP in local development.
 */
export function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true
  const forwarded = request.headers.get('x-forwarded-proto')
  return forwarded !== null && forwarded.split(',')[0]!.trim().toLowerCase() === 'https'
}
