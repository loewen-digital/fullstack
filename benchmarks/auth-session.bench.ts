/**
 * Benchmarks for the auth module (session check hot path) — Task 9.3
 *
 * Run with: npm run bench
 */

import { describe, test } from 'vite-plus/test'
import { createAuth } from '../src/auth/index.js'
import type { AuthDbAdapter, AuthSession, AuthToken, AuthUser } from '../src/auth/index.js'

// ---------------------------------------------------------------------------
// In-memory DB adapter
// ---------------------------------------------------------------------------

function makeAdapter(): AuthDbAdapter {
  const sessions = new Map<string, AuthSession>()
  const tokens = new Map<string, AuthToken>()
  const users = new Map<string | number, AuthUser>()

  return {
    async findUserByEmail(email) {
      return [...users.values()].find((u) => u.email === email) ?? null
    },
    async findUserById(id) {
      return users.get(id) ?? null
    },
    async createSession(data) {
      const session: AuthSession = {
        ...data,
        id: Math.random().toString(36).slice(2),
      }
      sessions.set(data.token, session)
      return session
    },
    async findSession(token) {
      return sessions.get(token) ?? null
    },
    async deleteSession(token) {
      sessions.delete(token)
    },
    async deleteExpiredSessions(userId) {
      const now = Date.now()
      for (const [key, s] of sessions) {
        if (s.userId === userId && s.expiresAt.getTime() <= now) sessions.delete(key)
      }
    },
    async deleteUserSessions(userId) {
      for (const [key, s] of sessions) if (s.userId === userId) sessions.delete(key)
    },
    async createToken(data) {
      const token: AuthToken = {
        ...data,
        id: Math.random().toString(36).slice(2),
      }
      tokens.set(token.id, token)
      return token
    },
    async findToken(token, type) {
      return [...tokens.values()].find((t) => t.token === token && t.type === type) ?? null
    },
    async findUserToken(userId, type) {
      return [...tokens.values()].find((t) => t.userId === userId && t.type === type) ?? null
    },
    async countTokenAttempt(id) {
      const token = tokens.get(id)
      if (!token) return null
      token.attempts = (token.attempts ?? 0) + 1
      return token.attempts
    },
    async deleteToken(id) {
      tokens.delete(id)
    },
    async deleteTokens(userId, type) {
      for (const [id, t] of tokens) if (t.userId === userId && t.type === type) tokens.delete(id)
    },
    async updateUserPassword(_id, _passwordHash) {},
    async markEmailVerified(_id) {},
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const db = makeAdapter()
const auth = createAuth({ sessionTtl: 3600 }, { db })
const testUser: AuthUser = { id: 'user-1', email: 'bench@example.com' }

// Pre-create a valid session token used in benchmarks
let validToken: string

async function setup() {
  const session = await auth.createSession(testUser)
  validToken = session.token
}

await setup()

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('auth — validateSession', () => {
  test('valid session token (cache-warm)', async ({ bench }) => {
    await bench('valid session token (cache-warm)', async () => {
      await auth.validateSession(validToken)
    }).run()
  })

  test('non-existent token (miss)', async ({ bench }) => {
    await bench('non-existent token (miss)', async () => {
      await auth.validateSession('00000000000000000000000000000000deadbeef')
    }).run()
  })
})

describe('auth — hashPassword / verifyPassword', () => {
  // These are intentionally slow (crypto.subtle PBKDF2) — benchmark to establish baselines
  test('hashPassword', async ({ bench }) => {
    await bench('hashPassword', async () => {
      await auth.hashPassword('correct-horse-battery-staple')
    }).run({ time: 500 })
  })

  test('verifyPassword (match)', async ({ bench }) => {
    const storedHash = await auth.hashPassword('correct-horse-battery-staple')
    await bench('verifyPassword (match)', async () => {
      await auth.verifyPassword('correct-horse-battery-staple', storedHash)
    }).run({ time: 500 })
  })
})
