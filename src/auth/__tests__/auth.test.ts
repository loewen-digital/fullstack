import { describe, it, expect, beforeEach } from 'vitest'
import { createAuth } from '../index.js'
import type { AuthDbAdapter, AuthUser, AuthSession, AuthToken } from '../types.js'

// ─── In-memory DB adapter for testing ────────────────────────────────────────

function createTestDb(): AuthDbAdapter {
  const users: AuthUser[] = [
    { id: '1', email: 'alice@example.com', passwordHash: null, emailVerifiedAt: null },
    { id: '2', email: 'bob@example.com', passwordHash: null, emailVerifiedAt: new Date() },
  ]
  const sessions: AuthSession[] = []
  const tokens: AuthToken[] = []

  return {
    async findUserByEmail(email) {
      return users.find((u) => u.email === email) ?? null
    },
    async findUserById(id) {
      return users.find((u) => String(u.id) === String(id)) ?? null
    },
    async createSession(data) {
      const session: AuthSession = { id: crypto.randomUUID(), ...data }
      sessions.push(session)
      return session
    },
    async findSession(token) {
      return sessions.find((s) => s.token === token) ?? null
    },
    async deleteSession(token) {
      const idx = sessions.findIndex((s) => s.token === token)
      if (idx !== -1) sessions.splice(idx, 1)
    },
    async deleteExpiredSessions(userId) {
      const now = new Date()
      const toRemove = sessions.filter(
        (s) => String(s.userId) === String(userId) && s.expiresAt < now,
      )
      for (const s of toRemove) {
        const idx = sessions.findIndex((x) => x.token === s.token)
        if (idx !== -1) sessions.splice(idx, 1)
      }
    },
    async createToken(data) {
      const token: AuthToken = { id: crypto.randomUUID(), ...data }
      tokens.push(token)
      return token
    },
    async findToken(token, type) {
      return tokens.find((t) => t.token === token && t.type === type) ?? null
    },
    async markTokenUsed(id) {
      const t = tokens.find((x) => x.id === id)
      if (t) t.usedAt = new Date()
    },
    async updateUserPassword(id, passwordHash) {
      const user = users.find((u) => String(u.id) === String(id))
      if (user) user.passwordHash = passwordHash
    },
    async markEmailVerified(id) {
      const user = users.find((u) => String(u.id) === String(id))
      if (user) user.emailVerifiedAt = new Date()
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let db: AuthDbAdapter
let auth: ReturnType<typeof createAuth>

beforeEach(() => {
  db = createTestDb()
  auth = createAuth({}, { db })
})

describe('password hashing', () => {
  it('hashes a password', async () => {
    const hash = await auth.hashPassword('secret123')
    expect(hash).toMatch(/^scrypt:/)
  })

  it('verifies the correct password', async () => {
    const hash = await auth.hashPassword('mypassword')
    expect(await auth.verifyPassword('mypassword', hash)).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await auth.hashPassword('correct')
    expect(await auth.verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('session management', () => {
  it('creates a session for a user', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    expect(session.token).toBeTruthy()
    expect(session.userId).toBe(user.id)
  })

  it('validates a valid session', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    const validated = await auth.validateSession(session.token)
    expect(validated).not.toBeNull()
    expect(validated!.userId).toBe(user.id)
  })

  it('returns null for a non-existent token', async () => {
    const result = await auth.validateSession('fake-token')
    expect(result).toBeNull()
  })

  it('destroys a session', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    await auth.destroySession(session.token)
    const result = await auth.validateSession(session.token)
    expect(result).toBeNull()
  })

  it('rejects expired sessions', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    // Create session with TTL = -1 (already expired)
    const authWithShortTtl = createAuth({ sessionTtl: -1 }, { db })
    const session = await authWithShortTtl.createSession(user)
    const result = await auth.validateSession(session.token)
    expect(result).toBeNull()
  })
})

describe('one-time tokens', () => {
  it('generates and verifies a token', async () => {
    const userId = await auth.generateToken('1', 'custom_type')
    const result = await auth.verifyToken(userId, 'custom_type')
    expect(result).toBe('1')
  })

  it('rejects a used token', async () => {
    const token = await auth.generateToken('1', 'test')
    await auth.verifyToken(token, 'test')
    const second = await auth.verifyToken(token, 'test')
    expect(second).toBeNull()
  })

  it('rejects expired tokens', async () => {
    const token = await auth.generateToken('1', 'test', -10)
    const result = await auth.verifyToken(token, 'test')
    expect(result).toBeNull()
  })

  it('rejects tokens with wrong type', async () => {
    const token = await auth.generateToken('1', 'type_a')
    const result = await auth.verifyToken(token, 'type_b')
    expect(result).toBeNull()
  })
})

describe('email verification', () => {
  it('sends and verifies email', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    let sentToken = ''

    await auth.sendVerificationEmail(user, async (_email, token) => {
      sentToken = token
    })

    expect(sentToken).toBeTruthy()
    const verified = await auth.verifyEmail(sentToken)
    expect(verified).not.toBeNull()
    expect(verified!.emailVerifiedAt).toBeTruthy()
  })

  it('returns null for invalid verification token', async () => {
    const result = await auth.verifyEmail('bad-token')
    expect(result).toBeNull()
  })
})

describe('password reset', () => {
  it('sends and resets password', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    let sentToken = ''

    await auth.sendPasswordResetEmail(user, async (_email, token) => {
      sentToken = token
    })

    const success = await auth.resetPassword(sentToken, 'newPassword123')
    expect(success).toBe(true)

    // Verify new password works
    const updatedUser = (await db.findUserByEmail('alice@example.com'))!
    expect(await auth.verifyPassword('newPassword123', updatedUser.passwordHash!)).toBe(true)
  })

  it('returns false for invalid reset token', async () => {
    const result = await auth.resetPassword('bad-token', 'new')
    expect(result).toBe(false)
  })
})

describe('OAuth scaffold', () => {
  it('creates a Google provider', () => {
    const provider = auth.oauthProvider('google', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://example.com/callback',
    })
    const url = provider.getAuthorizationUrl('state-123')
    expect(url.hostname).toBe('accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('state')).toBe('state-123')
  })

  it('creates a GitHub provider', () => {
    const provider = auth.oauthProvider('github', {
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      redirectUri: 'https://example.com/callback',
    })
    const url = provider.getAuthorizationUrl('my-state')
    expect(url.hostname).toBe('github.com')
    expect(url.searchParams.get('scope')).toContain('read:user')
  })

  it('throws for unknown providers', () => {
    expect(() =>
      auth.oauthProvider('unknown', {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
      }),
    ).toThrow('Unknown OAuth provider')
  })
})
