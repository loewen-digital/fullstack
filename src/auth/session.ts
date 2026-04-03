import { randomBytes } from 'node:crypto'
import type { AuthDbAdapter, AuthSession, AuthUser } from './types.js'

const SESSION_TOKEN_BYTES = 32

/**
 * Create a new authenticated session for a user.
 */
export async function createAuthSession(
  db: AuthDbAdapter,
  user: AuthUser,
  ttlSeconds = 7 * 24 * 3600, // 7 days
): Promise<AuthSession> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  return db.createSession({
    userId: user.id,
    token,
    expiresAt,
    createdAt: now,
  })
}

/**
 * Validate a session token. Returns the session if valid, null if expired or not found.
 */
export async function validateAuthSession(
  db: AuthDbAdapter,
  token: string,
): Promise<AuthSession | null> {
  const session = await db.findSession(token)
  if (!session) return null
  if (session.expiresAt < new Date()) {
    await db.deleteSession(token)
    return null
  }
  return session
}

/**
 * Destroy a session by token.
 */
export async function destroyAuthSession(db: AuthDbAdapter, token: string): Promise<void> {
  await db.deleteSession(token)
}
