/**
 * Fetch adapter types. Everything is a Web Standard `Request` or `Headers`; the adapter needs
 * no framework and no runtime types.
 */

import type { AuthInstance, AuthSession } from '../../auth/index.js'
import type { BillingEntitlements } from '../../billing/index.js'

/** What the adapter reads from a stack: the auth instance that validates the cookie's token. */
export interface FetchAdapterStack {
  auth: Pick<AuthInstance, 'validateSession'>
  /**
   * Opt in to `entitlements()` on the result of `sessionOf`: the billing instance, or anything
   * with its `entitlements` method.
   */
  billing?: { entitlements(userId: string): Promise<BillingEntitlements> }
}

export interface FetchAdapterOptions {
  /**
   * Cookie name used to store the auth token.
   * Default: 'fs_token'
   */
  authCookie?: string

  /**
   * Whether the auth cookie carries `Secure`.
   * Default: `true`. Over plain HTTP, local development, pass `isSecureRequest(request)` or
   * `false`: a browser that does not treat the host as trustworthy drops a `Secure` cookie.
   */
  secure?: boolean

  /**
   * The cookie's `SameSite` attribute. `'none'` needs `secure`.
   * Default: 'lax'
   */
  sameSite?: 'lax' | 'strict' | 'none'

  /**
   * Lifetime of the auth cookie in seconds; keep it in step with `sessionTtl` of the auth config.
   * Default: 7 days
   */
  maxAge?: number
}

/** Per-call overrides of the factory's options. */
export interface FetchAuthCookieOptions {
  secure?: boolean
  maxAge?: number
}

export interface FetchSessionResult {
  /** The validated session behind the auth cookie, or `null`. */
  session: AuthSession | null
  /**
   * The `Set-Cookie` value that deletes the auth cookie, when the request carried one that is
   * unknown or expired; `null` otherwise. Append it to the response so the browser stops sending
   * the dead token.
   */
  clearCookie: string | null
  /**
   * What the signed-in user may use, from billing; `null` without a session or without `billing`
   * in the stack. Reads the store on the first call and answers every further call from that read.
   */
  entitlements(): Promise<BillingEntitlements | null>
}

export interface FetchAdapterInstance {
  /** Validate the auth cookie of a request. */
  sessionOf(request: Request): Promise<FetchSessionResult>
  /** Append the `Set-Cookie` header that stores the auth token, after a login. */
  setAuthCookie(headers: Headers, token: string, options?: FetchAuthCookieOptions): void
  /** Append the `Set-Cookie` header that deletes the auth cookie, on logout. */
  clearAuthCookie(headers: Headers, options?: Pick<FetchAuthCookieOptions, 'secure'>): void
}
