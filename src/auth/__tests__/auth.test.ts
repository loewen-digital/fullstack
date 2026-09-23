import { describe, it, expect, beforeEach } from 'vitest'
import { createAuth, hashToken } from '../index.js'
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
    async deleteUserSessions(userId) {
      for (let i = sessions.length - 1; i >= 0; i--) {
        if (String(sessions[i]!.userId) === String(userId)) sessions.splice(i, 1)
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
    async deleteToken(id) {
      const idx = tokens.findIndex((t) => t.id === id)
      if (idx !== -1) tokens.splice(idx, 1)
    },
    async deleteTokens(userId, type) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (String(tokens[i]!.userId) === String(userId) && tokens[i]!.type === type) tokens.splice(i, 1)
      }
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

  it('removes the user\'s expired sessions on login, and only those', async () => {
    const alice = (await db.findUserByEmail('alice@example.com'))!
    const bob = (await db.findUserByEmail('bob@example.com'))!
    const expiredAuth = createAuth({ sessionTtl: -1 }, { db })
    const aliceStale = await expiredAuth.createSession(alice)
    const bobStale = await expiredAuth.createSession(bob)
    const aliceLive = await auth.createSession(alice)

    await auth.createSession(alice)

    expect(await db.findSession(await hashToken(aliceStale.token))).toBeNull()
    expect(await db.findSession(await hashToken(aliceLive.token))).not.toBeNull()
    expect(await db.findSession(await hashToken(bobStale.token))).not.toBeNull()
  })

  it('stores the session under the SHA-256 hash of the token, never the token', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    expect(session.token).toMatch(/^[0-9a-f]{64}$/)

    expect(await db.findSession(session.token)).toBeNull()
    const stored = await db.findSession(await hashToken(session.token))
    expect(stored?.id).toBe(session.id)
    expect(stored?.token).not.toBe(session.token)
  })

  it('the stored hash presented as a token does not validate', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    expect(await auth.validateSession(await hashToken(session.token))).toBeNull()
  })

  it('destroyUserSessions logs the user out everywhere, and nobody else', async () => {
    const alice = (await db.findUserByEmail('alice@example.com'))!
    const bob = (await db.findUserByEmail('bob@example.com'))!
    const phone = await auth.createSession(alice)
    const laptop = await auth.createSession(alice)
    const bobs = await auth.createSession(bob)

    await auth.destroyUserSessions(alice.id)

    expect(await auth.validateSession(phone.token)).toBeNull()
    expect(await auth.validateSession(laptop.token)).toBeNull()
    expect(await auth.validateSession(bobs.token)).not.toBeNull()
  })

  it('validateSession returns the presented token, so destroySession takes what it returned', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)
    const validated = (await auth.validateSession(session.token))!
    expect(validated.token).toBe(session.token)

    await auth.destroySession(validated.token)
    expect(await auth.validateSession(session.token)).toBeNull()
    expect(await db.findSession(await hashToken(session.token))).toBeNull()
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

  it('stores the hash of the token; the hash itself does not verify', async () => {
    const token = await auth.generateToken('1', 'invite')
    const hash = await hashToken(token)

    expect(await db.findToken(token, 'invite')).toBeNull()
    expect((await db.findToken(hash, 'invite'))?.userId).toBe('1')
    expect(await auth.verifyToken(hash, 'invite')).toBeNull()
    expect(await auth.verifyToken(token, 'invite')).toBe('1')
  })

  it('a new token replaces the user\'s earlier tokens of that type, and only those', async () => {
    const first = await auth.generateToken('1', 'invite')
    const otherType = await auth.generateToken('1', 'magic_link')
    const otherUser = await auth.generateToken('2', 'invite')
    const second = await auth.generateToken('1', 'invite')

    expect(await db.findToken(await hashToken(first), 'invite')).toBeNull()
    expect(await auth.verifyToken(first, 'invite')).toBeNull()
    expect(await auth.verifyToken(second, 'invite')).toBe('1')
    expect(await auth.verifyToken(otherType, 'magic_link')).toBe('1')
    expect(await auth.verifyToken(otherUser, 'invite')).toBe('2')
  })

  it('a consumed token is deleted from the store', async () => {
    const token = await auth.generateToken('1', 'invite')
    const hash = await hashToken(token)
    expect(await db.findToken(hash, 'invite')).not.toBeNull()

    await auth.verifyToken(token, 'invite')
    expect(await db.findToken(hash, 'invite')).toBeNull()
  })

  it('an expired token is deleted when presented', async () => {
    const token = await auth.generateToken('1', 'invite', -10)
    const hash = await hashToken(token)
    expect(await db.findToken(hash, 'invite')).not.toBeNull()

    expect(await auth.verifyToken(token, 'invite')).toBeNull()
    expect(await db.findToken(hash, 'invite')).toBeNull()
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

  it('only the most recently sent verification link works', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const sent: string[] = []
    const collect = async (_email: string, token: string): Promise<void> => {
      sent.push(token)
    }

    await auth.sendVerificationEmail(user, collect) // mailed to the old address
    await auth.sendVerificationEmail({ ...user, email: 'alice@new.example.com' }, collect)

    expect(await auth.verifyEmail(sent[0]!)).toBeNull()
    expect((await auth.verifyEmail(sent[1]!))?.emailVerifiedAt).toBeTruthy()
  })
})

describe('password reset', () => {
  it('sends and resets password', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    let sentToken = ''

    await auth.sendPasswordResetEmail(user, async (_email, token) => {
      sentToken = token
    })

    const reset = await auth.resetPassword(sentToken, 'newPassword123')
    expect(reset?.id).toBe(user.id)
    expect(reset?.email).toBe('alice@example.com')

    // The returned user carries the new hash, and the new password works
    expect(await auth.verifyPassword('newPassword123', reset!.passwordHash!)).toBe(true)
    const updatedUser = (await db.findUserByEmail('alice@example.com'))!
    expect(await auth.verifyPassword('newPassword123', updatedUser.passwordHash!)).toBe(true)
  })

  it('returns null for invalid reset token', async () => {
    const result = await auth.resetPassword('bad-token', 'new')
    expect(result).toBeNull()
  })

  it('a used reset token does not reset again', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    let sentToken = ''
    await auth.sendPasswordResetEmail(user, async (_email, token) => {
      sentToken = token
    })

    expect(await auth.resetPassword(sentToken, 'first')).not.toBeNull()
    expect(await auth.resetPassword(sentToken, 'second')).toBeNull()
    const after = (await db.findUserByEmail('alice@example.com'))!
    expect(await auth.verifyPassword('first', after.passwordHash!)).toBe(true)
  })

  it('revokes every session of the user, and only theirs', async () => {
    const alice = (await db.findUserByEmail('alice@example.com'))!
    const bob = (await db.findUserByEmail('bob@example.com'))!
    const attacker = await auth.createSession(alice)
    const own = await auth.createSession(alice)
    const bobs = await auth.createSession(bob)
    let sentToken = ''
    await auth.sendPasswordResetEmail(alice, async (_email, token) => {
      sentToken = token
    })

    const reset = await auth.resetPassword(sentToken, 'recovered')

    expect(await auth.validateSession(attacker.token)).toBeNull()
    expect(await auth.validateSession(own.token)).toBeNull()
    expect(await auth.validateSession(bobs.token)).not.toBeNull()
    const fresh = await auth.createSession(reset!)
    expect(await auth.validateSession(fresh.token)).not.toBeNull()
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
