import type { AuthDbAdapter, AuthSweep } from './types.js'

/**
 * Remove every session and one-time token that has expired, of all users, and say how many.
 *
 * The rest of the module tidies up per user (docs/decisions/0002): what an account leaves behind
 * that never comes back stays until this runs. Only the store can find it, so an adapter
 * without `deleteExpired` is an error and not a sweep that found nothing: zeros would read as
 * "nothing had expired" (docs/decisions/0040).
 */
export async function sweepExpired(db: AuthDbAdapter): Promise<AuthSweep> {
  if (!db.deleteExpired) {
    throw new Error('sweep needs an AuthDbAdapter with deleteExpired(now).')
  }
  const { sessions, tokens } = await db.deleteExpired(new Date())
  return { sessions, tokens }
}
