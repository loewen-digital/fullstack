import type { AuthDbAdapter, AuthToken } from './types.js'
import { hashToken, randomToken } from './opaque-token.js'

/**
 * Generate a cryptographically secure random token and persist its hash.
 * Returns the raw token string; it travels in the mail and never into the store.
 *
 * The user's earlier tokens of the same type are deleted first: only the most
 * recently issued link works, and nothing piles up for an active user.
 */
export async function generateToken(
  db: AuthDbAdapter,
  userId: string | number,
  type: string,
  ttlSeconds = 3600,
): Promise<string> {
  await db.deleteTokens(userId, type)

  const token = randomToken()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  await db.createToken({
    userId,
    token: await hashToken(token),
    type,
    expiresAt,
    createdAt: new Date(),
  })

  return token
}

/**
 * Verify and consume a one-time token: the record is deleted, whether it was
 * valid or found expired. Returns the userId if valid, null otherwise.
 */
export async function verifyToken(
  db: AuthDbAdapter,
  token: string,
  type: string,
): Promise<string | number | null> {
  const record: AuthToken | null = await db.findToken(await hashToken(token), type)
  if (!record) return null

  await db.deleteToken(record.id)
  if (record.expiresAt < new Date()) return null
  return record.userId
}
