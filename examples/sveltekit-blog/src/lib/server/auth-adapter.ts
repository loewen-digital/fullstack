/**
 * Auth DB adapter — implements the AuthDbAdapter interface against the
 * Drizzle schema defined in ./schema.ts.
 *
 * Pass this to createStack() as the `authDb` dependency.
 */

import { eq, and, lt } from 'drizzle-orm'
import type { AuthDbAdapter, AuthUser, AuthSession, AuthToken } from '@loewen-digital/fullstack/auth'
import type { DbInstance } from '@loewen-digital/fullstack/db'
import { users, authSessions, authTokens } from './schema.js'
import type { schema } from './stack.js'

type DB = DbInstance<typeof schema>['drizzle']

function rowToUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash ?? null,
    emailVerifiedAt: row.emailVerifiedAt ?? null,
  }
}

function rowToSession(row: typeof authSessions.$inferSelect): AuthSession {
  return {
    id: row.id,
    userId: row.userId,
    token: row.token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }
}

function rowToToken(row: typeof authTokens.$inferSelect): AuthToken {
  return {
    id: row.id,
    userId: row.userId,
    token: row.token,
    type: row.type,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    createdAt: row.createdAt,
  }
}

export function createAuthAdapter(db: DB): AuthDbAdapter {
  return {
    async findUserByEmail(email) {
      const row = await db.select().from(users).where(eq(users.email, email)).get()
      return row ? rowToUser(row) : null
    },

    async findUserById(id) {
      const row = await db.select().from(users).where(eq(users.id, String(id))).get()
      return row ? rowToUser(row) : null
    },

    async createSession(data) {
      const id = crypto.randomUUID()
      const row = { id, userId: String(data.userId), token: data.token, expiresAt: data.expiresAt, createdAt: data.createdAt }
      await db.insert(authSessions).values(row)
      return { ...row, id }
    },

    async findSession(token) {
      const row = await db.select().from(authSessions).where(eq(authSessions.token, token)).get()
      return row ? rowToSession(row) : null
    },

    async deleteSession(token) {
      await db.delete(authSessions).where(eq(authSessions.token, token))
    },

    async deleteExpiredSessions(userId) {
      await db.delete(authSessions).where(
        and(
          eq(authSessions.userId, String(userId)),
          lt(authSessions.expiresAt, new Date()),
        ),
      )
    },

    async createToken(data) {
      const id = crypto.randomUUID()
      const row = {
        id,
        userId: String(data.userId),
        token: data.token,
        type: data.type,
        expiresAt: data.expiresAt,
        usedAt: data.usedAt ?? null,
        createdAt: data.createdAt,
      }
      await db.insert(authTokens).values(row)
      return rowToToken({ ...row })
    },

    async findToken(token, type) {
      const row = await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.token, token), eq(authTokens.type, type)))
        .get()
      return row ? rowToToken(row) : null
    },

    async markTokenUsed(id) {
      await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, id))
    },

    async updateUserPassword(id, passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, String(id)))
    },

    async markEmailVerified(id) {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, String(id)))
    },
  }
}
