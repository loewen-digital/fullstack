import type { AuthDbAdapter, AuthToken } from './types.js'
import { hashToken, randomToken } from './opaque-token.js'

/**
 * Generate a cryptographically secure random token and persist its hash.
 * Returns the raw token string; it travels in the mail and never into the store.
 */
export async function generateToken(
  db: AuthDbAdapter,
  userId: string | number,
  type: string,
  ttlSeconds = 3600,
): Promise<string> {
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
 * Verify and consume a one-time token.
 * Returns the userId if valid, null otherwise.
 */
export async function verifyToken(
  db: AuthDbAdapter,
  token: string,
  type: string,
): Promise<string | number | null> {
  const record: AuthToken | null = await db.findToken(await hashToken(token), type)

  if (!record) return null
  if (record.usedAt) return null
  if (record.expiresAt < new Date()) return null

  await db.markTokenUsed(record.id)
  return record.userId
}
