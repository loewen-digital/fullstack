import { randomBytes } from 'node:crypto'
import type { AuthDbAdapter, AuthToken } from './types.js'

const TOKEN_BYTES = 32

/**
 * Generate a cryptographically secure random token and persist it.
 * Returns the raw token string (not hashed).
 */
export async function generateToken(
  db: AuthDbAdapter,
  userId: string | number,
  type: string,
  ttlSeconds = 3600,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  await db.createToken({
    userId,
    token,
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
  const record: AuthToken | null = await db.findToken(token, type)

  if (!record) return null
  if (record.usedAt) return null
  if (record.expiresAt < new Date()) return null

  await db.markTokenUsed(record.id)
  return record.userId
}
