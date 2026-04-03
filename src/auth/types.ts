/**
 * Auth module types.
 *
 * The auth module is DB-agnostic: it receives adapter functions for all
 * database operations so it works with any Drizzle schema.
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
  token: string
  expiresAt: Date
  createdAt: Date
}

/** A one-time token (email verification, password reset). */
export interface AuthToken {
  id: string
  userId: string | number
  token: string
  type: 'email_verification' | 'password_reset' | string
  expiresAt: Date
  usedAt?: Date | null
  createdAt: Date
}

/** DB adapter interface — implement these against your Drizzle schema. */
export interface AuthDbAdapter {
  findUserByEmail(email: string): Promise<AuthUser | null>
  findUserById(id: string | number): Promise<AuthUser | null>
  createSession(data: Omit<AuthSession, 'id'>): Promise<AuthSession>
  findSession(token: string): Promise<AuthSession | null>
  deleteSession(token: string): Promise<void>
  deleteExpiredSessions(userId: string | number): Promise<void>
  createToken(data: Omit<AuthToken, 'id'>): Promise<AuthToken>
  findToken(token: string, type: string): Promise<AuthToken | null>
  markTokenUsed(id: string): Promise<void>
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
