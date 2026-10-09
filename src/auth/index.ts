import type {
  AuthConfig,
  AuthDbAdapter,
  AuthInstance,
  AuthUser,
  AuthSession,
  TouchedAuthSession,
  OAuthProviderConfig,
  OAuthProvider,
} from './types.js'
import { hashPassword, verifyPassword } from './password.js'
import {
  createAuthSession,
  touchAuthSession,
  validateAuthSession,
  type SessionExtension,
  destroyAuthSession,
  destroyUserSessions,
} from './session.js'
import { generateToken, verifyToken } from './token.js'
import { sendVerificationEmail, verifyEmail } from './email-verification.js'
import { sendPasswordResetEmail, resetPassword } from './password-reset.js'
import { sendLoginCode, verifyLoginCode, type LoginCodeOptions } from './login-code.js'
import { createOAuthProvider } from './oauth.js'

export type { AuthInstance, AuthUser, AuthSession, AuthDbAdapter, AuthConfig, TouchedAuthSession }
export type {
  AuthToken,
  OAuthProvider,
  OAuthProviderConfig,
  OAuthTokens,
  OAuthUserInfo,
} from './types.js'
export { hashPassword, verifyPassword } from './password.js'
export { hashToken } from './opaque-token.js'
export { createOAuthProvider } from './oauth.js'

/**
 * Create an auth instance.
 *
 * The `db` parameter is an `AuthDbAdapter`: implement it against your storage,
 * or use `createFlatdbAuthAdapter` from `@loewen-digital/fullstack/auth/flatdb`.
 *
 * Usage:
 *   const auth = createAuth({ sessionTtl: 604800 }, { db: myAuthAdapter })
 *   const session = await auth.createSession(user)
 *   const valid = await auth.validateSession(session.token)
 */
export function createAuth(config: AuthConfig, deps: { db: AuthDbAdapter }): AuthInstance {
  const { db } = deps
  const sessionTtl = config.sessionTtl ?? 7 * 24 * 3600
  const emailVerificationTtl = config.emailVerificationTtl ?? 24 * 3600
  const passwordResetTtl = config.passwordResetTtl ?? 3600
  const loginCode: LoginCodeOptions = {
    secret: config.loginCodeSecret,
    ttlSeconds: config.loginCodeTtl ?? 600,
    length: config.loginCodeLength ?? 6,
    maxAttempts: config.loginCodeAttempts ?? 5,
  }
  if (!Number.isInteger(loginCode.length) || loginCode.length < 6 || loginCode.length > 12) {
    throw new Error('loginCodeLength must be an integer from 6 to 12.')
  }
  if (!Number.isInteger(loginCode.maxAttempts) || loginCode.maxAttempts < 1) {
    throw new Error('loginCodeAttempts must be an integer of at least 1.')
  }
  let extension: SessionExtension | undefined
  if (config.sessionExtendAfter !== undefined) {
    const afterSeconds = config.sessionExtendAfter
    if (!Number.isFinite(afterSeconds) || afterSeconds < 0 || afterSeconds >= sessionTtl) {
      throw new Error('sessionExtendAfter must be a number of seconds from 0 to below sessionTtl.')
    }
    if (!db.updateSessionExpiry) {
      throw new Error(
        'sessionExtendAfter needs an AuthDbAdapter with updateSessionExpiry(token, expiresAt).',
      )
    }
    extension = { ttlSeconds: sessionTtl, afterSeconds }
  }

  return {
    hashPassword(password: string): Promise<string> {
      return hashPassword(password)
    },

    verifyPassword(password: string, hash: string): Promise<boolean> {
      return verifyPassword(password, hash)
    },

    createSession(user: AuthUser): Promise<AuthSession> {
      return createAuthSession(db, user, sessionTtl)
    },

    validateSession(token: string): Promise<AuthSession | null> {
      return validateAuthSession(db, token, extension)
    },

    touchSession(token: string): Promise<TouchedAuthSession> {
      return touchAuthSession(db, token, extension)
    },

    destroySession(token: string): Promise<void> {
      return destroyAuthSession(db, token)
    },

    destroyUserSessions(userId: string | number): Promise<void> {
      return destroyUserSessions(db, userId)
    },

    generateToken(userId: string | number, type: string, ttlSeconds?: number): Promise<string> {
      return generateToken(db, userId, type, ttlSeconds ?? 3600)
    },

    verifyToken(token: string, type: string): Promise<string | number | null> {
      return verifyToken(db, token, type)
    },

    sendVerificationEmail(
      user: AuthUser,
      sendFn: (email: string, token: string) => Promise<void>,
    ): Promise<void> {
      return sendVerificationEmail(db, user, sendFn, emailVerificationTtl)
    },

    verifyEmail(token: string): Promise<AuthUser | null> {
      return verifyEmail(db, token)
    },

    sendPasswordResetEmail(
      user: AuthUser,
      sendFn: (email: string, token: string) => Promise<void>,
    ): Promise<void> {
      return sendPasswordResetEmail(db, user, sendFn, passwordResetTtl)
    },

    resetPassword(token: string, newPassword: string): Promise<AuthUser | null> {
      return resetPassword(db, token, newPassword)
    },

    sendLoginCode(
      user: AuthUser,
      sendFn: (email: string, code: string) => Promise<void>,
    ): Promise<void> {
      return sendLoginCode(db, user, sendFn, loginCode)
    },

    verifyLoginCode(user: AuthUser, code: string): Promise<string | number | null> {
      return verifyLoginCode(db, user, code, loginCode)
    },

    oauthProvider(name: string, providerConfig: OAuthProviderConfig): OAuthProvider {
      return createOAuthProvider(name, providerConfig)
    },
  }
}
