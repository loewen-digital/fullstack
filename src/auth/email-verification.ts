import type { AuthDbAdapter, AuthUser } from './types.js'
import { generateToken, verifyToken } from './token.js'

export const EMAIL_VERIFICATION_TYPE = 'email_verification'
const DEFAULT_TTL = 24 * 3600 // 24 hours

/**
 * Generate and send an email verification token.
 */
export async function sendVerificationEmail(
  db: AuthDbAdapter,
  user: AuthUser,
  sendFn: (email: string, token: string) => Promise<void>,
  ttlSeconds = DEFAULT_TTL,
): Promise<void> {
  const token = await generateToken(db, user.id, EMAIL_VERIFICATION_TYPE, ttlSeconds)
  await sendFn(user.email, token)
}

/**
 * Verify an email verification token and mark the user's email as verified.
 * Returns the user on success, null on failure.
 */
export async function verifyEmail(
  db: AuthDbAdapter,
  token: string,
): Promise<AuthUser | null> {
  const userId = await verifyToken(db, token, EMAIL_VERIFICATION_TYPE)
  if (userId === null) return null

  await db.markEmailVerified(userId)
  return db.findUserById(userId)
}
