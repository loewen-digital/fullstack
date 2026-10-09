import type { AuthDbAdapter, AuthSession, AuthUser, TouchedAuthSession } from './types.js'
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

/** When a validated session gets a later expiry: `sessionTtl` and `sessionExtendAfter` of the config. */
export interface SessionExtension {
  ttlSeconds: number
  afterSeconds: number
}

/**
 * Validate a session token and, with `extension`, move its expiry to now plus the TTL.
 *
 * The store is written when the new expiry lies at least `afterSeconds` behind the stored one.
 * A session expires one TTL after its last extension, so that distance is the time since then,
 * and the store needs no extra field. An expiry is never moved earlier: after a shorter
 * `sessionTtl` the sessions that are out run to the end they were given.
 *
 * The returned session carries the presented token, not the stored hash, so
 * `destroyAuthSession(db, session.token)` works on what this returns.
 */
export async function touchAuthSession(
  db: AuthDbAdapter,
  token: string,
  extension?: SessionExtension,
): Promise<TouchedAuthSession> {
  const hash = await hashToken(token)
  const session = await db.findSession(hash)
  if (!session) return { session: null, extended: false }
  const now = new Date()
  if (session.expiresAt < now) {
    await db.deleteSession(hash)
    return { session: null, extended: false }
  }
  if (extension && db.updateSessionExpiry) {
    const expiresAt = new Date(now.getTime() + extension.ttlSeconds * 1000)
    if (expiresAt.getTime() - session.expiresAt.getTime() >= extension.afterSeconds * 1000) {
      await db.updateSessionExpiry(hash, expiresAt)
      return { session: { ...session, expiresAt, token }, extended: true }
    }
  }
  return { session: { ...session, token }, extended: false }
}

/**
 * Validate a session token. Returns the session if valid, null if expired or not found;
 * extends it like `touchAuthSession` without saying so.
 */
export async function validateAuthSession(
  db: AuthDbAdapter,
  token: string,
  extension?: SessionExtension,
): Promise<AuthSession | null> {
  return (await touchAuthSession(db, token, extension)).session
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
export async function destroyUserSessions(
  db: AuthDbAdapter,
  userId: string | number,
): Promise<void> {
  await db.deleteUserSessions(userId)
}
