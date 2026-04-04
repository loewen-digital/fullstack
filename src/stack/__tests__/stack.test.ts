import { describe, it, expect } from 'vitest'
import { createStack } from '../index.js'
import { ConfigError } from '../../errors/index.js'
import type { AuthDbAdapter, AuthUser, AuthSession, AuthToken } from '../../auth/index.js'

// ── Minimal in-memory AuthDbAdapter for tests ──────────────────────────────

function createTestAuthDb(): AuthDbAdapter {
  const users = new Map<string | number, AuthUser>()
  const sessions = new Map<string, AuthSession>()
  const tokens = new Map<string, AuthToken>()

  return {
    async findUserByEmail(email) {
      return [...users.values()].find(u => u.email === email) ?? null
    },
    async findUserById(id) {
      return users.get(id) ?? null
    },
    async createSession(data) {
      const session: AuthSession = { id: crypto.randomUUID(), ...data }
      sessions.set(session.token, session)
      return session
    },
    async findSession(token) {
      return sessions.get(token) ?? null
    },
    async deleteSession(token) {
      sessions.delete(token)
    },
    async deleteExpiredSessions() {
      // no-op for tests
    },
    async createToken(data) {
      const token: AuthToken = { id: crypto.randomUUID(), ...data }
      tokens.set(token.token, token)
      return token
    },
    async findToken(token, type) {
      const t = tokens.get(token)
      return t && t.type === type ? t : null
    },
    async markTokenUsed(id) {
      for (const t of tokens.values()) {
        if (t.id === id) {
          t.usedAt = new Date()
        }
      }
    },
    async updateUserPassword(id, passwordHash) {
      const user = users.get(id)
      if (user) user.passwordHash = passwordHash
    },
    async markEmailVerified(id) {
      const user = users.get(id)
      if (user) user.emailVerifiedAt = new Date()
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('createStack', () => {
  it('returns an empty stack for empty config', () => {
    const stack = createStack({})
    expect(Object.keys(stack)).toHaveLength(0)
  })

  it('initializes db module when configured', () => {
    const stack = createStack({
      db: { driver: 'sqlite', url: ':memory:' },
    })
    expect(stack.db).toBeDefined()
    expect(typeof stack.db.migrate).toBe('function')
    expect(typeof stack.db.drizzle).toBe('object')
    stack.db.close()
  })

  it('initializes mail module when configured', () => {
    const stack = createStack({
      mail: { driver: 'console', silent: true },
    })
    expect(stack.mail).toBeDefined()
    expect(typeof stack.mail.send).toBe('function')
  })

  it('initializes cache module when configured', () => {
    const stack = createStack({
      cache: { driver: 'memory' },
    })
    expect(stack.cache).toBeDefined()
    expect(typeof stack.cache.get).toBe('function')
  })

  it('initializes storage module when configured', () => {
    const stack = createStack({
      storage: { driver: 'memory' },
    })
    expect(stack.storage).toBeDefined()
    expect(typeof stack.storage.put).toBe('function')
  })

  it('initializes queue module when configured', () => {
    const stack = createStack({
      queue: { driver: 'memory' },
    })
    expect(stack.queue).toBeDefined()
    expect(typeof stack.queue.dispatch).toBe('function')
  })

  it('initializes session module when configured', () => {
    const stack = createStack({
      session: { driver: 'memory' },
    })
    expect(stack.session).toBeDefined()
    expect(typeof stack.session.load).toBe('function')
  })

  it('initializes security module when configured', () => {
    const stack = createStack({
      security: { csrf: true },
    })
    expect(stack.security).toBeDefined()
    expect(typeof stack.security.generateCsrfToken).toBe('function')
  })

  it('initializes logging module when configured', () => {
    const stack = createStack({
      logging: { level: 'warn' },
    })
    expect(stack.logging).toBeDefined()
    expect(typeof stack.logging.info).toBe('function')
  })

  it('initializes i18n module when configured', () => {
    const stack = createStack({
      i18n: { defaultLocale: 'en', locales: ['en'] },
    })
    expect(stack.i18n).toBeDefined()
    expect(typeof stack.i18n.t).toBe('function')
  })

  it('initializes permissions module when configured', () => {
    const stack = createStack({
      permissions: { roles: [{ name: 'admin', permissions: ['*'] }] },
    })
    expect(stack.permissions).toBeDefined()
    expect(typeof stack.permissions.can).toBe('function')
  })

  it('initializes webhooks module when configured', () => {
    const stack = createStack({
      webhooks: { secret: 'test-secret' },
    })
    expect(stack.webhooks).toBeDefined()
    expect(typeof stack.webhooks.send).toBe('function')
  })

  it('initializes realtime module when configured', () => {
    const stack = createStack({
      realtime: {},
    })
    expect(stack.realtime).toBeDefined()
    expect(typeof stack.realtime.broadcast).toBe('function')
  })

  it('initializes auth module when configured with authDb dep', () => {
    const authDb = createTestAuthDb()
    const stack = createStack(
      {
        db: { driver: 'sqlite', url: ':memory:' },
        auth: { sessionTtl: 3600 },
      },
      { authDb },
    )
    expect(stack.auth).toBeDefined()
    expect(typeof stack.auth.hashPassword).toBe('function')
    expect(typeof stack.auth.createSession).toBe('function')
    stack.db.close()
  })

  it('throws ConfigError when auth is configured without authDb', () => {
    expect(() =>
      createStack({ auth: { sessionTtl: 3600 } }),
    ).toThrow(ConfigError)
  })

  it('initializes notifications with mail dependency when both configured', () => {
    const stack = createStack({
      mail: { driver: 'console', silent: true },
      notifications: {},
    })
    expect(stack.notifications).toBeDefined()
    expect(typeof stack.notifications.notify).toBe('function')
  })

  it('initializes multiple modules together', () => {
    const stack = createStack({
      db: { driver: 'sqlite', url: ':memory:' },
      cache: { driver: 'memory' },
      mail: { driver: 'console', silent: true },
      storage: { driver: 'memory' },
      queue: { driver: 'memory' },
      session: { driver: 'memory' },
      logging: { level: 'error' },
    })
    expect(stack.db).toBeDefined()
    expect(stack.cache).toBeDefined()
    expect(stack.mail).toBeDefined()
    expect(stack.storage).toBeDefined()
    expect(stack.queue).toBeDefined()
    expect(stack.session).toBeDefined()
    expect(stack.logging).toBeDefined()
    stack.db.close()
  })

  it('search module initializes with sqlite-fts driver', () => {
    const stack = createStack({
      search: { driver: 'sqlite-fts', url: ':memory:' },
    })
    expect(stack.search).toBeDefined()
    expect(typeof stack.search.index).toBe('function')
    expect(typeof stack.search.search).toBe('function')
  })

  it('TypeScript: only configured modules appear in return type', () => {
    const stack = createStack({ cache: { driver: 'memory' } })
    // @ts-expect-error — db was not configured
    void stack.db
    expect(stack.cache).toBeDefined()
  })
})
