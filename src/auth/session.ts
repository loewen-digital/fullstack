import type { AuthDbAdapter, AuthSession, AuthUser } from './types.js'
import { hashToken, randomToken } from './opaque-token.js'

/**
 * Create a new authenticated session for a user.
 *
 * The user's expired sessions are removed first, so the session store stays
 * bounded without a scheduled job (docs/decisions/0002). The store receives
 * the hash of the token; the returned session carries the raw token, the value
 * the cookie has to hold.
 */
export async function createAuthSession(
  db: AuthDbAdapter,
  user: AuthUser,
  ttlSeconds = 7 * 24 * 3600, // 7 days
): Promise<AuthSession> {
  await db.deleteExpiredSessions(user.id)

  const token = randomToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  const stored = await db.createSession({
    userId: user.id,
    token: await hashToken(token),
    expiresAt,
    createdAt: now,
  })
  return { ...stored, token }
}

/**
 * Validate a session token. Returns the session if valid, null if expired or not found.
 * The returned session carries the presented token, not the stored hash, so
 * `destroyAuthSession(db, session.token)` works on what this returns.
 */
export async function validateAuthSession(
  db: AuthDbAdapter,
  token: string,
): Promise<AuthSession | null> {
  const hash = await hashToken(token)
  const session = await db.findSession(hash)
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.deleteSession(hash)
    return null
  }
  return { ...session, token }
}

/**
 * Destroy a session by its raw token.
 */
export async function destroyAuthSession(db: AuthDbAdapter, token: string): Promise<void> {
  await db.deleteSession(await hashToken(token))
}

/**
 * Destroy every session of a user: logout on every device, the caller's included.
 */
export async function destroyUserSessions(db: AuthDbAdapter, userId: string | number): Promise<void> {
  await db.deleteUserSessions(userId)
}
