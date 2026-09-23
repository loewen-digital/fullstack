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

/**
 * A one-time token (email verification, password reset). It exists while it is
 * valid: issuing a new token of the same type for the user deletes the earlier
 * ones, and presenting it, consumed or expired, deletes it.
 */
export interface AuthToken {
  id: string
  userId: string | number
  /** The SHA-256 hash of the raw token; the raw token only travels in the mail. */
  token: string
  type: 'email_verification' | 'password_reset' | string
  expiresAt: Date
  createdAt: Date
}

/**
 * Persistence interface of the auth module. Implement it against your storage
 * (a Drizzle schema, flatdb collections via `@loewen-digital/fullstack/auth/flatdb`, ...).
 *
 * Session and one-time tokens arrive hashed: `createSession` and `createToken`
 * receive `hashToken(raw)` in `token`, and `findSession`, `deleteSession` and
 * `findToken` are called with the same hash. The adapter stores and compares
 * what it gets and never sees a raw token.
 */
export interface AuthDbAdapter {
  findUserByEmail(email: string): Promise<AuthUser | null>
  findUserById(id: string | number): Promise<AuthUser | null>
  createSession(data: Omit<AuthSession, 'id'>): Promise<AuthSession>
  findSession(token: string): Promise<AuthSession | null>
  deleteSession(token: string): Promise<void>
  deleteExpiredSessions(userId: string | number): Promise<void>
  createToken(data: Omit<AuthToken, 'id'>): Promise<AuthToken>
  findToken(token: string, type: string): Promise<AuthToken | null>
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
  /** Token TTL in seconds for email verification (default: 24 hours) */
  emailVerificationTtl?: number
  /** Token TTL in seconds for password reset (default: 1 hour) */
  passwordResetTtl?: number
}

export interface AuthInstance {
  /** Hash a plaintext password */
  hashPassword(password: string): Promise<string>
  /** Verify a plaintext password against a stored hash */
  verifyPassword(password: string, hash: string): Promise<boolean>
  /** Create a new authenticated session for a user */
  createSession(user: AuthUser): Promise<AuthSession>
  /** Validate a session token and return the associated session, or null if invalid/expired */
  validateSession(token: string): Promise<AuthSession | null>
  /** Destroy a session by token */
  destroySession(token: string): Promise<void>
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
  /** Reset a user's password using the token */
  resetPassword(token: string, newPassword: string): Promise<boolean>
  /** Create an OAuth provider instance */
  oauthProvider(name: string, config: OAuthProviderConfig): OAuthProvider
}
