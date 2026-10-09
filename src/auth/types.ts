/**
 * Auth module types.
 *
 * The auth module is storage-agnostic: it receives an `AuthDbAdapter` for all
 * persistence, so it runs on Drizzle, flatdb or anything else that can look up
 * users, sessions and tokens.
 */

/** Minimum shape required of a user record by the auth module. */
export interface AuthUser {
  id: string | number
  email: string
  passwordHash?: string | null
  emailVerifiedAt?: Date | null
}

/** An active user session stored server-side. */
export interface AuthSession {
  id: string
  userId: string | number
  /**
   * In the store: the SHA-256 hash of the raw token, as `AuthDbAdapter` receives
   * and looks it up. On the sessions `createSession` and `validateSession`
   * return: the raw token, the value the cookie carries.
   */
  token: string
  expiresAt: Date
  createdAt: Date
}

/** What `touchSession` answers: the validated session and whether its expiry was just moved. */
export interface TouchedAuthSession {
  session: AuthSession | null
  /** `true` when this call wrote a later `expiresAt`; the cookie then has to be sent again. */
  extended: boolean
}

/**
 * A one-time token (email verification, password reset, login code). It exists
 * while it is valid: issuing a new token of the same type for the user deletes
 * the earlier ones, and presenting it, consumed or expired, deletes it.
 */
export interface AuthToken {
  id: string
  userId: string | number
  /**
   * The SHA-256 hash of the raw token; the raw token only travels in the mail.
   * For a login code: its HMAC under `loginCodeSecret`.
   */
  token: string
  type: 'email_verification' | 'password_reset' | 'login_code' | string
  expiresAt: Date
  createdAt: Date
  /** Verification attempts so far. Login codes carry it, starting at 0; other tokens do not. */
  attempts?: number
}

/**
 * Persistence interface of the auth module. Implement it against your storage
 * (a Drizzle schema, flatdb collections via `@loewen-digital/fullstack/auth/flatdb`, ...).
 *
 * Session and one-time tokens arrive hashed: `createSession` and `createToken`
 * receive `hashToken(raw)` in `token`, and `findSession`, `deleteSession` and
 * `findToken` are called with the same hash. The adapter stores and compares
 * what it gets and never sees a raw token. A login code arrives as its HMAC
 * and is looked up by user through `findUserToken`.
 */
export interface AuthDbAdapter {
  findUserByEmail(email: string): Promise<AuthUser | null>
  findUserById(id: string | number): Promise<AuthUser | null>
  createSession(data: Omit<AuthSession, 'id'>): Promise<AuthSession>
  findSession(token: string): Promise<AuthSession | null>
  deleteSession(token: string): Promise<void>
  /**
   * Set a later `expiresAt` on the session with that token hash; `sessionExtendAfter` needs it.
   * Updates the session that is there and creates none: a logout that arrives at the same
   * moment stays a logout.
   */
  updateSessionExpiry?(token: string, expiresAt: Date): Promise<void>
  deleteExpiredSessions(userId: string | number): Promise<void>
  /** Remove every session of the user; a password reset and `destroyUserSessions` call it */
  deleteUserSessions(userId: string | number): Promise<void>
  createToken(data: Omit<AuthToken, 'id'>): Promise<AuthToken>
  findToken(token: string, type: string): Promise<AuthToken | null>
  /**
   * The user's token of that type; there is at most one, a new one replaces the earlier.
   * A login code is found this way, never by its hash, so a guess reaches only the user's own code.
   */
  findUserToken(userId: string | number, type: string): Promise<AuthToken | null>
  /**
   * Count one verification attempt on a token (`attempts + 1`) and return the new count; `null`
   * when the token is gone. Atomic where the store can, so guesses that arrive together all count.
   */
  countTokenAttempt(id: string): Promise<number | null>
  /** Remove one token, consumed or found expired */
  deleteToken(id: string): Promise<void>
  /** Remove every token of the user with that type; called before a new one is issued */
  deleteTokens(userId: string | number, type: string): Promise<void>
  updateUserPassword(id: string | number, passwordHash: string): Promise<void>
  markEmailVerified(id: string | number): Promise<void>
}

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scope?: string
}

export interface OAuthUserInfo {
  id: string
  email?: string
  name?: string
  avatarUrl?: string
  raw: Record<string, unknown>
}

export interface OAuthProvider {
  /** Get the URL to redirect the user to for authorization */
  getAuthorizationUrl(state: string): URL
  /** Exchange an authorization code for tokens + user info */
  handleCallback(code: string, state: string): Promise<{ tokens: OAuthTokens; user: OAuthUserInfo }>
}

export interface AuthConfig {
  /** Session TTL in seconds (default: 7 days) */
  sessionTtl?: number
  /**
   * Keep a session alive while it is used: a session that is validated at least this many
   * seconds after its login or its last extension expires `sessionTtl` from now. It is the
   * shortest time between two writes to the session store, so a day costs one write per session
   * and day; `0` writes on every validation. Needs `updateSessionExpiry` on the adapter and has
   * to be less than `sessionTtl`. Default: unset, a session ends `sessionTtl` after the login.
   */
  sessionExtendAfter?: number
  /** Token TTL in seconds for email verification (default: 24 hours) */
  emailVerificationTtl?: number
  /** Token TTL in seconds for password reset (default: 1 hour) */
  passwordResetTtl?: number
  /**
   * Secret the login codes are stored under (HMAC-SHA-256); `sendLoginCode` and `verifyLoginCode`
   * throw without it. A code has few digits: its plain hash would give it away to anyone who reads
   * the store. Changing the secret invalidates the codes that are out.
   */
  loginCodeSecret?: string
  /** Login code TTL in seconds (default: 10 minutes) */
  loginCodeTtl?: number
  /** Digits of a login code, 6 to 12 (default: 6) */
  loginCodeLength?: number
  /** Verifications a login code allows before it is deleted, the right one included (default: 5) */
  loginCodeAttempts?: number
}

export interface AuthInstance {
  /** Hash a plaintext password */
  hashPassword(password: string): Promise<string>
  /** Verify a plaintext password against a stored hash */
  verifyPassword(password: string, hash: string): Promise<boolean>
  /** Create a new authenticated session for a user */
  createSession(user: AuthUser): Promise<AuthSession>
  /**
   * Validate a session token and return the associated session, or null if invalid/expired.
   * With `sessionExtendAfter` the session's expiry moves as it does in `touchSession`.
   */
  validateSession(token: string): Promise<AuthSession | null>
  /**
   * `validateSession` that also says whether the expiry was moved, which only happens with
   * `sessionExtendAfter`. The adapters call it and send the auth cookie again when `extended`.
   */
  touchSession(token: string): Promise<TouchedAuthSession>
  /** Destroy a session by token */
  destroySession(token: string): Promise<void>
  /** Destroy every session of a user: logout everywhere, the recovery step after a takeover */
  destroyUserSessions(userId: string | number): Promise<void>
  /** Generate a one-time token for a user (email verification, password reset, etc.) */
  generateToken(userId: string | number, type: string, ttlSeconds?: number): Promise<string>
  /** Verify and consume a one-time token, returning the user id on success */
  verifyToken(token: string, type: string): Promise<string | number | null>
  /** Send an email verification token */
  sendVerificationEmail(
    user: AuthUser,
    sendFn: (email: string, token: string) => Promise<void>,
  ): Promise<void>
  /** Mark a user's email as verified using the token */
  verifyEmail(token: string): Promise<AuthUser | null>
  /** Send a password reset token */
  sendPasswordResetEmail(
    user: AuthUser,
    sendFn: (email: string, token: string) => Promise<void>,
  ): Promise<void>
  /**
   * Reset a user's password using the token and revoke every session of the user.
   * Returns the user, or null when the token is unknown, used or expired.
   */
  resetPassword(token: string, newPassword: string): Promise<AuthUser | null>
  /**
   * Passwordless login: mint a numeric code, replace the user's earlier one and hand the code to
   * `sendFn`. Needs `loginCodeSecret`.
   */
  sendLoginCode(
    user: AuthUser,
    sendFn: (email: string, code: string) => Promise<void>,
  ): Promise<void>
  /**
   * Verify and consume the user's login code. Returns the user id once for the right code within
   * its TTL, null otherwise; after `loginCodeAttempts` verifications the code is gone.
   */
  verifyLoginCode(user: AuthUser, code: string): Promise<string | number | null>
  /** Create an OAuth provider instance */
  oauthProvider(name: string, config: OAuthProviderConfig): OAuthProvider
}
