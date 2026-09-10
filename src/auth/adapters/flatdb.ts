import type { AuthDbAdapter, AuthSession, AuthToken, AuthUser } from '../types.js'

/** A document as a flatdb auto-mode collection returns it. */
export type FlatdbDocument = Record<string, unknown> & { _id: string }

/**
 * The slice of a flatdb auto-mode `Collection` this adapter uses.
 *
 * Declared here so this file never imports `@loewen-digital/flatdb` (an
 * optional peer dependency); any `Collection` from flatdb satisfies it
 * structurally, the same way `RedisClient` works for the redis session driver.
 */
export interface FlatdbCollection {
  insert(doc: Record<string, unknown>): Promise<FlatdbDocument>
  findById(id: string): Promise<FlatdbDocument | null>
  findOne(filter: Record<string, unknown>): Promise<FlatdbDocument | null>
  update(filter: Record<string, unknown>, changes: Record<string, unknown>): Promise<number>
  delete(filter: Record<string, unknown>): Promise<number>
}

export interface FlatdbAuthCollections {
  /** The app's own users collection. Documents carry `email`, `passwordHash`, `emailVerifiedAt`. */
  users: FlatdbCollection
  /** Auth sessions: `userId`, `token`, `expiresAt`, `createdAt`. */
  sessions: FlatdbCollection
  /** One-time tokens: `userId`, `token`, `type`, `expiresAt`, `usedAt`, `createdAt`. */
  tokens: FlatdbCollection
}

/**
 * `AuthDbAdapter` on flatdb collections.
 *
 * Dates are stored as ISO 8601 strings (JSON has no `Date`; ISO strings order
 * correctly under flatdb's `$lt`) and returned as `Date`. flatdb's `_id` is the
 * `id` the auth module sees. When a collection has a zod schema, that schema
 * must declare the fields listed on `FlatdbAuthCollections`; flatdb strips
 * unknown fields on write by default.
 *
 * Usage:
 *   const db = flatdb(adapter, { users: collection(userSchema), sessions: collection(), tokens: collection() })
 *   const auth = createAuth({}, { db: createFlatdbAuthAdapter(db) })
 *
 * flatdb 0.2 types every collection as `Collection | PathCollection`; until
 * loewen-digital/flatdb#7 lands, pass `db.users as Collection` and so on.
 */
export function createFlatdbAuthAdapter(collections: FlatdbAuthCollections): AuthDbAdapter {
  const { users, sessions, tokens } = collections

  return {
    async findUserByEmail(email) {
      const doc = await users.findOne({ email })
      return doc ? toUser(doc) : null
    },

    async findUserById(id) {
      const doc = await users.findById(String(id))
      return doc ? toUser(doc) : null
    },

    async createSession(data) {
      const doc = await sessions.insert({
        userId: data.userId,
        token: data.token,
        expiresAt: data.expiresAt.toISOString(),
        createdAt: data.createdAt.toISOString(),
      })
      return toSession(doc)
    },

    async findSession(token) {
      const doc = await sessions.findOne({ token })
      return doc ? toSession(doc) : null
    },

    async deleteSession(token) {
      await sessions.delete({ token })
    },

    async deleteExpiredSessions(userId) {
      await sessions.delete({ userId, expiresAt: { $lt: new Date().toISOString() } })
    },

    async createToken(data) {
      const doc = await tokens.insert({
        userId: data.userId,
        token: data.token,
        type: data.type,
        expiresAt: data.expiresAt.toISOString(),
        usedAt: data.usedAt ? data.usedAt.toISOString() : null,
        createdAt: data.createdAt.toISOString(),
      })
      return toToken(doc)
    },

    async findToken(token, type) {
      const doc = await tokens.findOne({ token, type })
      return doc ? toToken(doc) : null
    },

    async markTokenUsed(id) {
      await tokens.update({ _id: id }, { usedAt: new Date().toISOString() })
    },

    async updateUserPassword(id, passwordHash) {
      await users.update({ _id: String(id) }, { passwordHash })
    },

    async markEmailVerified(id) {
      await users.update({ _id: String(id) }, { emailVerifiedAt: new Date().toISOString() })
    },
  }
}

function toUser(doc: FlatdbDocument): AuthUser {
  if (typeof doc.email !== 'string') {
    throw new TypeError(
      `flatdb auth adapter: user ${doc._id} has no "email". ` +
        'The users schema must declare email, passwordHash and emailVerifiedAt; flatdb strips undeclared fields.',
    )
  }
  return {
    id: doc._id,
    email: doc.email,
    passwordHash: typeof doc.passwordHash === 'string' ? doc.passwordHash : null,
    emailVerifiedAt: toNullableDate(doc.emailVerifiedAt, 'emailVerifiedAt'),
  }
}

function toSession(doc: FlatdbDocument): AuthSession {
  return {
    id: doc._id,
    userId: toUserId(doc.userId),
    token: String(doc.token),
    expiresAt: toDate(doc.expiresAt, 'expiresAt'),
    createdAt: toDate(doc.createdAt, 'createdAt'),
  }
}

function toToken(doc: FlatdbDocument): AuthToken {
  return {
    id: doc._id,
    userId: toUserId(doc.userId),
    token: String(doc.token),
    type: String(doc.type),
    expiresAt: toDate(doc.expiresAt, 'expiresAt'),
    usedAt: toNullableDate(doc.usedAt, 'usedAt'),
    createdAt: toDate(doc.createdAt, 'createdAt'),
  }
}

function toUserId(value: unknown): string | number {
  return typeof value === 'number' ? value : String(value)
}

function toDate(value: unknown, field: string): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  throw new TypeError(`flatdb auth adapter: "${field}" is not an ISO date string: ${JSON.stringify(value)}`)
}

function toNullableDate(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : toDate(value, field)
}
