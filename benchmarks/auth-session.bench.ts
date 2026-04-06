/**
 * Benchmarks for the auth module (session check hot path) — Task 9.3
 *
 * Run with: npm run bench
 */

import { bench, describe } from 'vitest'
import { createAuth } from '../src/auth/index.js'
import type { AuthDbAdapter, AuthSession, AuthUser } from '../src/auth/index.js'

// ---------------------------------------------------------------------------
// In-memory DB adapter
// ---------------------------------------------------------------------------

function makeAdapter(): AuthDbAdapter {
  const sessions = new Map<string, AuthSession>()
  const tokens = new Map<string, { userId: string | number; type: string; expiresAt: Date }>()
  const users = new Map<string | number, AuthUser>()

  return {
    async createSession(data) {
      const session: AuthSession = { ...data, id: Math.random().toString(36).slice(2) }
      sessions.set(data.token, session)
      return session
    },
    async findSession(token) {
      return sessions.get(token) ?? null
    },
    async deleteSession(token) {
      sessions.delete(token)
    },
    async createToken(data) {
      tokens.set(data.token, { userId: data.userId, type: data.type, expiresAt: data.expiresAt })
    },
    async findToken(token, type) {
      const t = tokens.get(token)
      if (!t || t.type !== type) return null
      return { token, ...t }
    },
    async deleteToken(token) {
      tokens.delete(token)
    },
    async findUserById(id) {
      return users.get(id) ?? null
    },
    async findUserByEmail(_email) {
      return null
    },
    async markEmailVerified(_userId) {},
    async updatePassword(_userId, _hash) {},
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
  bench('valid session token (cache-warm)', async () => {
    await auth.validateSession(validToken)
  })

  bench('non-existent token (miss)', async () => {
    await auth.validateSession('00000000000000000000000000000000deadbeef')
  })
})

describe('auth — hashPassword / verifyPassword', () => {
  // These are intentionally slow (crypto.subtle PBKDF2) — benchmark to establish baselines
  bench('hashPassword', { time: 500 }, async () => {
    await auth.hashPassword('correct-horse-battery-staple')
  })

  let storedHash: string
  bench('verifyPassword (match)', { time: 500 }, async () => {
    if (!storedHash) storedHash = await auth.hashPassword('correct-horse-battery-staple')
    await auth.verifyPassword('correct-horse-battery-staple', storedHash)
  })
})
