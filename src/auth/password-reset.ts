import type { AuthDbAdapter, AuthUser } from './types.js'
import { generateToken, verifyToken } from './token.js'
import { hashPassword } from './password.js'

export const PASSWORD_RESET_TYPE = 'password_reset'
const DEFAULT_TTL = 3600 // 1 hour

/**
 * Generate and send a password reset token.
 */
export async function sendPasswordResetEmail(
  db: AuthDbAdapter,
  user: AuthUser,
  sendFn: (email: string, token: string) => Promise<void>,
  ttlSeconds = DEFAULT_TTL,
): Promise<void> {
  const token = await generateToken(db, user.id, PASSWORD_RESET_TYPE, ttlSeconds)
  await sendFn(user.email, token)
}

/**
 * Verify a password reset token, update the user's password and revoke every
 * session of the user: a reset is the recovery path after a takeover, and a
 * session the attacker opened must not survive it. Returns the user, so the
 * app can open a fresh session for the browser that reset the password;
 * null when the token is unknown, used or expired.
 */
export async function resetPassword(
  db: AuthDbAdapter,
  token: string,
  newPassword: string,
): Promise<AuthUser | null> {
  const userId = await verifyToken(db, token, PASSWORD_RESET_TYPE)
  if (userId === null) return null

  const passwordHash = await hashPassword(newPassword)
  await db.updateUserPassword(userId, passwordHash)
  await db.deleteUserSessions(userId)
  return db.findUserById(userId)
}
