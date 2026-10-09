import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test'
import { createAuth, hashToken } from '../index.js'
import type { AuthDbAdapter, AuthUser, AuthSession, AuthToken } from '../types.js'

// ─── In-memory DB adapter for testing ────────────────────────────────────────

function createTestDb(): AuthDbAdapter {
  const users: AuthUser[] = [
    {
      id: '1',
      email: 'alice@example.com',
      passwordHash: null,
      emailVerifiedAt: null,
    },
    {
      id: '2',
      email: 'bob@example.com',
      passwordHash: null,
      emailVerifiedAt: new Date(),
    },
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
    async updateSessionExpiry(token, expiresAt) {
      const session = sessions.find((s) => s.token === token)
      if (session) session.expiresAt = expiresAt
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
    async findUserToken(userId, type) {
      return tokens.find((t) => String(t.userId) === String(userId) && t.type === type) ?? null
    },
    async countTokenAttempt(id) {
      const token = tokens.find((t) => t.id === id)
      if (!token) return null
      token.attempts = (token.attempts ?? 0) + 1
      return token.attempts
    },
    async deleteToken(id) {
      const idx = tokens.findIndex((t) => t.id === id)
      if (idx !== -1) tokens.splice(idx, 1)
    },
    async deleteTokens(userId, type) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (String(tokens[i]!.userId) === String(userId) && tokens[i]!.type === type)
          tokens.splice(i, 1)
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

  it("removes the user's expired sessions on login, and only those", async () => {
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

describe('session extension', () => {
  const HOUR = 3600
  const DAY = 24 * HOUR
  const START = new Date('2026-01-01T00:00:00.000Z')

  function later(seconds: number): Date {
    return new Date(START.getTime() + seconds * 1000)
  }

  async function stored(token: string): Promise<Date | undefined> {
    return (await db.findSession(await hashToken(token)))?.expiresAt
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: START })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('without sessionExtendAfter a session ends a fixed time after the login', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await auth.createSession(user)

    vi.setSystemTime(later(6 * DAY))
    expect(await auth.touchSession(session.token)).toMatchObject({ extended: false })
    expect((await auth.validateSession(session.token))?.expiresAt).toEqual(later(7 * DAY))
    expect(await stored(session.token)).toEqual(later(7 * DAY))

    vi.setSystemTime(later(7 * DAY + 1))
    expect(await auth.validateSession(session.token)).toBeNull()
  })

  it('extends a validated session once sessionExtendAfter has passed, and not before', async () => {
    const sliding = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: DAY }, { db })
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await sliding.createSession(user)

    vi.setSystemTime(later(HOUR))
    const early = await sliding.touchSession(session.token)
    expect(early.extended).toBe(false)
    expect(early.session?.expiresAt).toEqual(later(7 * DAY))
    expect(await stored(session.token)).toEqual(later(7 * DAY))

    vi.setSystemTime(later(DAY))
    const due = await sliding.touchSession(session.token)
    expect(due.extended).toBe(true)
    expect(due.session?.expiresAt).toEqual(later(8 * DAY))
    expect(due.session?.token).toBe(session.token)
    expect(await stored(session.token)).toEqual(later(8 * DAY))

    // The next request of the same day finds the session extended and writes nothing.
    vi.setSystemTime(later(DAY + HOUR))
    expect((await sliding.touchSession(session.token)).extended).toBe(false)
    expect(await stored(session.token)).toEqual(later(8 * DAY))
  })

  it('validateSession extends as well and returns the new expiry', async () => {
    const sliding = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: DAY }, { db })
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await sliding.createSession(user)

    vi.setSystemTime(later(2 * DAY))
    expect((await sliding.validateSession(session.token))?.expiresAt).toEqual(later(9 * DAY))
    expect(await stored(session.token)).toEqual(later(9 * DAY))
  })

  it('keeps a session alive that is used every day, and ends it one TTL after the last use', async () => {
    const sliding = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: DAY }, { db })
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await sliding.createSession(user)

    for (let day = 1; day <= 30; day++) {
      vi.setSystemTime(later(day * DAY))
      expect(await sliding.validateSession(session.token)).not.toBeNull()
    }

    vi.setSystemTime(later(37 * DAY + 1))
    expect(await sliding.validateSession(session.token)).toBeNull()
    expect(await stored(session.token)).toBeUndefined()
  })

  it('does not bring back a session that has run out', async () => {
    const sliding = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: DAY }, { db })
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await sliding.createSession(user)

    vi.setSystemTime(later(7 * DAY + 1))
    expect(await sliding.touchSession(session.token)).toEqual({ session: null, extended: false })
    expect(await stored(session.token)).toBeUndefined()
  })

  it('answers an unknown token without a session and without a write', async () => {
    const sliding = createAuth({ sessionExtendAfter: 0 }, { db })
    expect(await sliding.touchSession('fake-token')).toEqual({ session: null, extended: false })
  })

  it('0 extends on every validation', async () => {
    const sliding = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: 0 }, { db })
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await sliding.createSession(user)

    vi.setSystemTime(later(1))
    expect((await sliding.touchSession(session.token)).extended).toBe(true)
    vi.setSystemTime(later(2))
    expect((await sliding.touchSession(session.token)).extended).toBe(true)
    expect(await stored(session.token)).toEqual(later(7 * DAY + 2))
  })

  it('never moves an expiry earlier when sessionTtl got shorter', async () => {
    const user = (await db.findUserByEmail('alice@example.com'))!
    const session = await createAuth({ sessionTtl: 30 * DAY }, { db }).createSession(user)
    const shorter = createAuth({ sessionTtl: 7 * DAY, sessionExtendAfter: DAY }, { db })

    vi.setSystemTime(later(2 * DAY))
    const touched = await shorter.touchSession(session.token)
    expect(touched.extended).toBe(false)
    expect(touched.session?.expiresAt).toEqual(later(30 * DAY))
    expect(await stored(session.token)).toEqual(later(30 * DAY))
  })

  it('refuses a sessionExtendAfter that could never apply, and an adapter that cannot extend', () => {
    expect(() => createAuth({ sessionTtl: DAY, sessionExtendAfter: DAY }, { db })).toThrow(
      'sessionExtendAfter',
    )
    expect(() => createAuth({ sessionExtendAfter: -1 }, { db })).toThrow('sessionExtendAfter')
    expect(() => createAuth({ sessionExtendAfter: Number.NaN }, { db })).toThrow(
      'sessionExtendAfter',
    )

    const fixed: AuthDbAdapter = { ...db, updateSessionExpiry: undefined }
    expect(() => createAuth({ sessionExtendAfter: DAY }, { db: fixed })).toThrow(
      'updateSessionExpiry',
    )
    expect(() => createAuth({}, { db: fixed })).not.toThrow()
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

  it("a new token replaces the user's earlier tokens of that type, and only those", async () => {
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

describe('login codes', () => {
  const SECRET = 'login-code-secret'
  let codes: ReturnType<typeof createAuth>
  let alice: AuthUser
  let bob: AuthUser

  /** Send a code and return what the mail would carry. */
  async function send(user: AuthUser, instance = codes): Promise<string> {
    let sent = ''
    await instance.sendLoginCode(user, async (_email, code) => {
      sent = code
    })
    return sent
  }

  /** A code of the same length that is not `code`. */
  function wrong(code: string): string {
    return code === '000000' ? '000001' : '000000'
  }

  beforeEach(async () => {
    codes = createAuth({ loginCodeSecret: SECRET }, { db })
    alice = (await db.findUserByEmail('alice@example.com'))!
    bob = (await db.findUserByEmail('bob@example.com'))!
  })

  it('mails six digits and verifies them once', async () => {
    let mailedTo = ''
    let code = ''
    await codes.sendLoginCode(alice, async (email, c) => {
      mailedTo = email
      code = c
    })
    expect(mailedTo).toBe('alice@example.com')
    expect(code).toMatch(/^\d{6}$/)

    expect(await codes.verifyLoginCode(alice, code)).toBe('1')
    expect(await codes.verifyLoginCode(alice, code)).toBeNull()
    expect(await db.findUserToken('1', 'login_code')).toBeNull()
  })

  it('takes the length from loginCodeLength', async () => {
    const long = createAuth({ loginCodeSecret: SECRET, loginCodeLength: 8 }, { db })
    const code = await send(alice, long)
    expect(code).toMatch(/^\d{8}$/)
    expect(await long.verifyLoginCode(alice, code)).toBe('1')
  })

  it('refuses a length outside 6 to 12 and an attempt limit below 1', () => {
    expect(() => createAuth({ loginCodeLength: 4 }, { db })).toThrow(/loginCodeLength/)
    expect(() => createAuth({ loginCodeLength: 13 }, { db })).toThrow(/loginCodeLength/)
    expect(() => createAuth({ loginCodeLength: 6.5 }, { db })).toThrow(/loginCodeLength/)
    expect(() => createAuth({ loginCodeAttempts: 0 }, { db })).toThrow(/loginCodeAttempts/)
  })

  it('needs loginCodeSecret, to send and to verify', async () => {
    await expect(auth.sendLoginCode(alice, async () => {})).rejects.toThrow(/loginCodeSecret/)
    await expect(auth.verifyLoginCode(alice, '123456')).rejects.toThrow(/loginCodeSecret/)
    expect(await db.findUserToken('1', 'login_code')).toBeNull()
  })

  it('stores the HMAC of the code, not the code and not its plain hash', async () => {
    const code = await send(alice)
    const record = (await db.findUserToken('1', 'login_code'))!

    expect(record.token).toMatch(/^[0-9a-f]{64}$/)
    expect(record.token).not.toBe(code)
    expect(record.token).not.toBe(await hashToken(code))
    expect(record.token).not.toBe(await hashToken(`1:${code}`))
    expect(record.attempts).toBe(0)
  })

  it('a code under another secret does not verify', async () => {
    const code = await send(alice)
    const other = createAuth({ loginCodeSecret: 'another-secret' }, { db })
    expect(await other.verifyLoginCode(alice, code)).toBeNull()
  })

  it("is looked up per user: another user's code does not log in", async () => {
    const alices = await send(alice)
    await send(bob)

    // Force the collision the lookup has to survive: both users hold the same digits.
    const { hashLoginCode } = await import('../login-code.js')
    const bobsRecord = (await db.findUserToken('2', 'login_code'))!
    bobsRecord.token = await hashLoginCode(SECRET, '2', alices)

    expect(await codes.verifyLoginCode(bob, alices)).toBe('2')
    expect(await codes.verifyLoginCode(alice, alices)).toBe('1')
  })

  it("a user without a code does not verify with someone else's", async () => {
    const code = await send(alice)
    expect(await codes.verifyLoginCode(bob, code)).toBeNull()
    expect(await codes.verifyLoginCode(alice, code)).toBe('1')
  })

  it("a new code replaces the user's earlier one, and only theirs", async () => {
    const first = await send(alice)
    const bobs = await send(bob)
    const second = await send(alice)

    if (first !== second) expect(await codes.verifyLoginCode(alice, first)).toBeNull()
    expect(await codes.verifyLoginCode(bob, bobs)).toBe('2')
  })

  it('the latest code works after a resend', async () => {
    await send(alice)
    const second = await send(alice)
    expect(await codes.verifyLoginCode(alice, second)).toBe('1')
  })

  it('counts wrong codes and deletes the code with the fifth', async () => {
    const code = await send(alice)

    for (let i = 1; i <= 4; i++) {
      expect(await codes.verifyLoginCode(alice, wrong(code))).toBeNull()
      expect((await db.findUserToken('1', 'login_code'))?.attempts).toBe(i)
    }
    expect(await codes.verifyLoginCode(alice, wrong(code))).toBeNull()
    expect(await db.findUserToken('1', 'login_code')).toBeNull()

    // The right code comes too late; a new one works.
    expect(await codes.verifyLoginCode(alice, code)).toBeNull()
    const fresh = await send(alice)
    expect(await codes.verifyLoginCode(alice, fresh)).toBe('1')
  })

  it('the right code on the last allowed attempt still logs in', async () => {
    const code = await send(alice)
    for (let i = 0; i < 4; i++) await codes.verifyLoginCode(alice, wrong(code))
    expect(await codes.verifyLoginCode(alice, code)).toBe('1')
  })

  it('takes the limit from loginCodeAttempts', async () => {
    const strict = createAuth({ loginCodeSecret: SECRET, loginCodeAttempts: 1 }, { db })
    const code = await send(alice, strict)
    expect(await strict.verifyLoginCode(alice, wrong(code))).toBeNull()
    expect(await strict.verifyLoginCode(alice, code)).toBeNull()
  })

  it('a count the store already holds beyond the limit refuses the right code', async () => {
    const code = await send(alice)
    const record = (await db.findUserToken('1', 'login_code'))!
    record.attempts = 5

    expect(await codes.verifyLoginCode(alice, code)).toBeNull()
    expect(await db.findUserToken('1', 'login_code')).toBeNull()
  })

  it('input that is not a code of the right length counts as a wrong attempt', async () => {
    const code = await send(alice)
    for (const input of ['', 'abcdef', `${code}0`, code.slice(1), `${code.slice(0, 5)}x`]) {
      expect(await codes.verifyLoginCode(alice, input)).toBeNull()
    }
    expect(await db.findUserToken('1', 'login_code')).toBeNull()
  })

  it('surrounding whitespace is not part of the code', async () => {
    const code = await send(alice)
    expect(await codes.verifyLoginCode(alice, ` ${code}\n`)).toBe('1')
  })

  it('an expired code is refused and deleted', async () => {
    const brief = createAuth({ loginCodeSecret: SECRET, loginCodeTtl: -10 }, { db })
    const code = await send(alice, brief)
    expect(await brief.verifyLoginCode(alice, code)).toBeNull()
    expect(await db.findUserToken('1', 'login_code')).toBeNull()
  })

  it('expires after ten minutes by default', async () => {
    const before = Date.now()
    await send(alice)
    const record = (await db.findUserToken('1', 'login_code'))!
    const ttl = record.expiresAt.getTime() - before
    expect(ttl).toBeGreaterThanOrEqual(600_000)
    expect(ttl).toBeLessThan(605_000)
  })

  it('leaves the tokens of other types alone', async () => {
    const invite = await auth.generateToken('1', 'invite')
    const code = await send(alice)
    expect(await codes.verifyLoginCode(alice, code)).toBe('1')
    expect(await auth.verifyToken(invite, 'invite')).toBe('1')
  })

  it('draws every digit, leading zeros included', async () => {
    const seen = new Set<string>()
    let leadingZero = false
    for (let i = 0; i < 200; i++) {
      const code = await send(alice)
      for (const digit of code) seen.add(digit)
      if (code.startsWith('0')) leadingZero = true
    }
    expect(seen.size).toBe(10)
    expect(leadingZero).toBe(true)
  })
})
