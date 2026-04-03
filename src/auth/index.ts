import type { AuthConfig, AuthDbAdapter, AuthInstance, AuthUser, AuthSession, OAuthProviderConfig, OAuthProvider } from './types.js'
import { hashPassword, verifyPassword } from './password.js'
import { createAuthSession, validateAuthSession, destroyAuthSession } from './session.js'
import { generateToken, verifyToken } from './token.js'
import { sendVerificationEmail, verifyEmail } from './email-verification.js'
import { sendPasswordResetEmail, resetPassword } from './password-reset.js'
import { createOAuthProvider } from './oauth.js'

export type { AuthInstance, AuthUser, AuthSession, AuthDbAdapter, AuthConfig }
export type { AuthToken, OAuthProvider, OAuthProviderConfig, OAuthTokens, OAuthUserInfo } from './types.js'
export { hashPassword, verifyPassword } from './password.js'
export { createOAuthProvider } from './oauth.js'

/**
 * Create an auth instance.
 *
 * The `db` parameter is a DB adapter — implement it against your Drizzle schema.
 *
 * Usage:
 *   const auth = createAuth({ sessionTtl: 604800 }, { db: myAuthAdapter })
 *   const session = await auth.createSession(user)
 *   const valid = await auth.validateSession(session.token)
 */
export function createAuth(
  config: AuthConfig,
  deps: { db: AuthDbAdapter },
): AuthInstance {
  const { db } = deps
  const sessionTtl = config.sessionTtl ?? 7 * 24 * 3600
  const emailVerificationTtl = config.emailVerificationTtl ?? 24 * 3600
  const passwordResetTtl = config.passwordResetTtl ?? 3600

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
      return validateAuthSession(db, token)
    },

    destroySession(token: string): Promise<void> {
      return destroyAuthSession(db, token)
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

    resetPassword(token: string, newPassword: string): Promise<boolean> {
      return resetPassword(db, token, newPassword)
    },

    oauthProvider(name: string, providerConfig: OAuthProviderConfig): OAuthProvider {
      return createOAuthProvider(name, providerConfig)
    },
  }
}
