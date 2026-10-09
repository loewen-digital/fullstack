import { describe, it, expect, vi } from 'vite-plus/test'
import { createFetchAdapter, isSameOrigin, isSecureRequest } from '../index.js'
import type { AuthSession } from '../../../auth/index.js'
import { createBilling, createMemoryBillingStore } from '../../../billing/index.js'
import { createFakeBillingDriver } from '../../../testing/index.js'

// ── Test helpers ───────────────────────────────────────────────────────────────

const SESSION: AuthSession = {
  id: 's1',
  userId: 'u1',
  token: 'valid-token',
  expiresAt: new Date(Date.now() + 3600_000),
  createdAt: new Date(),
}

/** An auth that knows one token and records what it was asked. */
function fakeAuth() {
  const asked: string[] = []
  return {
    asked,
    auth: {
      async validateSession(token: string): Promise<AuthSession | null> {
        asked.push(token)
        return token === SESSION.token ? SESSION : null
      },
    },
  }
}

function request(
  headers: Record<string, string> = {},
  url = 'https://app.example.com/api/me',
  method = 'GET',
): Request {
  return new Request(url, { method, headers })
}

// ── sessionOf ──────────────────────────────────────────────────────────────────

describe('sessionOf', () => {
  it('returns the validated session behind the auth cookie', async () => {
    const { auth, asked } = fakeAuth()
    const adapter = createFetchAdapter({ auth })

    const result = await adapter.sessionOf(request({ cookie: 'theme=dark; fs_token=valid-token' }))
    expect(result).toMatchObject({ session: SESSION, clearCookie: null })
    expect(asked).toEqual(['valid-token'])
  })

  it('answers null without asking auth when the request has no auth cookie', async () => {
    const { auth, asked } = fakeAuth()
    const adapter = createFetchAdapter({ auth })

    expect(await adapter.sessionOf(request())).toMatchObject({ session: null, clearCookie: null })
    expect(await adapter.sessionOf(request({ cookie: 'theme=dark' }))).toMatchObject({
      session: null,
      clearCookie: null,
    })
    expect(await adapter.sessionOf(request({ cookie: 'fs_token=' }))).toMatchObject({
      session: null,
      clearCookie: null,
    })
    expect(asked).toEqual([])
  })

  it('answers null plus the deleting Set-Cookie for an unknown or expired token', async () => {
    const { auth } = fakeAuth()
    const adapter = createFetchAdapter({ auth })

    const result = await adapter.sessionOf(request({ cookie: 'fs_token=stale' }))
    expect(result.session).toBeNull()
    expect(result.clearCookie).toBe('fs_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')
  })

  it('the deleting cookie follows the scheme of the request', async () => {
    const { auth } = fakeAuth()
    const adapter = createFetchAdapter({ auth })

    const result = await adapter.sessionOf(
      request({ cookie: 'fs_token=stale' }, 'http://localhost:8788/api/me'),
    )
    expect(result.clearCookie).toBe('fs_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  })

  it('reads the cookie under the configured name', async () => {
    const { auth } = fakeAuth()
    const adapter = createFetchAdapter({ auth }, { authCookie: 'sid' })

    const hit = await adapter.sessionOf(request({ cookie: 'fs_token=nope; sid=valid-token' }))
    expect(hit.session).toBe(SESSION)

    const miss = await adapter.sessionOf(request({ cookie: 'sid=stale' }))
    expect(miss.clearCookie).toMatch(/^sid=; /)
  })

  it('a cookie value that is not valid percent-encoding does not throw', async () => {
    const { auth, asked } = fakeAuth()
    const adapter = createFetchAdapter({ auth })

    const result = await adapter.sessionOf(request({ cookie: 'fs_token=%E0%A4%A' }))
    expect(result.session).toBeNull()
    expect(asked).toEqual(['%E0%A4%A'])
  })

  it('works on the session a real auth instance issued', async () => {
    const { createAuth } = await import('../../../auth/index.js')
    const sessions = new Map<string, AuthSession>()
    const auth = createAuth(
      {},
      {
        db: {
          findUserByEmail: async () => null,
          findUserById: async () => null,
          createSession: async (data) => {
            const session = { id: crypto.randomUUID(), ...data }
            sessions.set(session.token, session)
            return session
          },
          findSession: async (token) => sessions.get(token) ?? null,
          deleteSession: async (token) => void sessions.delete(token),
          deleteExpiredSessions: async () => {},
          deleteUserSessions: async () => {},
          createToken: async (data) => ({ id: crypto.randomUUID(), ...data }),
          findToken: async () => null,
          findUserToken: async () => null,
          countTokenAttempt: async () => null,
          deleteToken: async () => {},
          deleteTokens: async () => {},
          updateUserPassword: async () => {},
          markEmailVerified: async () => {},
        },
      },
    )
    const adapter = createFetchAdapter({ auth })

    // Login: the response carries the cookie, the next request sends it back.
    const issued = await auth.createSession({ id: 'u1', email: 'a@example.com' })
    const headers = new Headers()
    adapter.setAuthCookie(headers, issued.token)
    const cookie = headers.get('set-cookie')!.split(';')[0]!

    const { session } = await adapter.sessionOf(request({ cookie }))
    expect(session?.userId).toBe('u1')

    await auth.destroySession(issued.token)
    const after = await adapter.sessionOf(request({ cookie }))
    expect(after.session).toBeNull()
    expect(after.clearCookie).not.toBeNull()
  })
})

// ── refreshCookie ──────────────────────────────────────────────────────────────

describe('refreshCookie of an extended session', () => {
  /** An auth whose `touchSession` reports the one known session as extended, or not. */
  function touchingAuth(extended: boolean, expiresAt: Date) {
    return {
      async validateSession(): Promise<AuthSession | null> {
        throw new Error('the adapter has to ask touchSession')
      },
      async touchSession(token: string) {
        return token === SESSION.token
          ? { session: { ...SESSION, expiresAt }, extended }
          : { session: null, extended: false }
      },
    }
  }

  it('is the auth cookie again, alive until the session ends', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00.000Z') })
    try {
      const auth = touchingAuth(true, new Date('2026-01-31T00:00:00.000Z'))
      const adapter = createFetchAdapter({ auth }, { maxAge: 3600 })

      const result = await adapter.sessionOf(request({ cookie: 'fs_token=valid-token' }))
      expect(result.session?.token).toBe('valid-token')
      expect(result.clearCookie).toBeNull()
      expect(result.refreshCookie).toBe(
        `fs_token=valid-token; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; Secure; SameSite=Lax`,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows the scheme of the request and the configured name and SameSite', async () => {
    const auth = touchingAuth(true, new Date(Date.now() + 3600_000))
    const adapter = createFetchAdapter({ auth }, { authCookie: 'sid', sameSite: 'strict' })

    const result = await adapter.sessionOf(
      request({ cookie: 'sid=valid-token' }, 'http://localhost:8788/api/me'),
    )
    expect(result.refreshCookie).toMatch(
      /^sid=valid-token; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/,
    )
  })

  it('is null when the session was not extended, is unknown, or the request has no cookie', async () => {
    const still = createFetchAdapter({ auth: touchingAuth(false, SESSION.expiresAt) })
    const kept = await still.sessionOf(request({ cookie: 'fs_token=valid-token' }))
    expect(kept.session).not.toBeNull()
    expect(kept.refreshCookie).toBeNull()

    const extending = createFetchAdapter({ auth: touchingAuth(true, SESSION.expiresAt) })
    const unknown = await extending.sessionOf(request({ cookie: 'fs_token=stale' }))
    expect(unknown.refreshCookie).toBeNull()
    expect(unknown.clearCookie).not.toBeNull()
    expect((await extending.sessionOf(request())).refreshCookie).toBeNull()
  })

  it('is null for an auth that only has validateSession', async () => {
    const { auth } = fakeAuth()
    const result = await createFetchAdapter({ auth }).sessionOf(
      request({ cookie: 'fs_token=valid-token' }),
    )
    expect(result).toMatchObject({ session: SESSION, refreshCookie: null })
  })
})

// ── entitlements ───────────────────────────────────────────────────────────────

describe('entitlements of a session', () => {
  function paidBilling() {
    const driver = createFakeBillingDriver()
    const store = createMemoryBillingStore()
    const billing = createBilling({
      driver,
      store,
      products: { pro: { type: 'subscription', providerId: 'pri_pro', features: ['export'] } },
    })
    return { billing, store, driver }
  }

  it('resolves what the signed-in user paid for, with one store read', async () => {
    const { auth } = fakeAuth()
    const { billing, store, driver } = paidBilling()
    await billing.handleWebhook(
      driver.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro' }),
    )
    const reads = vi.spyOn(store, 'getAccount')
    const adapter = createFetchAdapter({ auth, billing })

    const result = await adapter.sessionOf(request({ cookie: 'fs_token=valid-token' }))
    // Nothing is read before the handler asks.
    expect(reads).not.toHaveBeenCalled()
    const first = await result.entitlements()
    const second = await result.entitlements()

    expect(first?.userId).toBe('u1')
    expect(first?.has('export')).toBe(true)
    expect(second).toBe(first)
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('answers null without a session and without billing in the stack', async () => {
    const { auth } = fakeAuth()
    const { billing, store } = paidBilling()
    const reads = vi.spyOn(store, 'getAccount')

    const anonymous = await createFetchAdapter({ auth, billing }).sessionOf(request())
    const expired = await createFetchAdapter({ auth, billing }).sessionOf(
      request({ cookie: 'fs_token=expired' }),
    )
    const noBilling = await createFetchAdapter({ auth }).sessionOf(
      request({ cookie: 'fs_token=valid-token' }),
    )

    expect(await anonymous.entitlements()).toBeNull()
    expect(await expired.entitlements()).toBeNull()
    expect(await noBilling.entitlements()).toBeNull()
    expect(reads).not.toHaveBeenCalled()
  })
})

// ── setAuthCookie / clearAuthCookie ────────────────────────────────────────────

describe('setAuthCookie', () => {
  it('writes the attributes the SvelteKit adapter sets, Secure by default', () => {
    const adapter = createFetchAdapter(fakeAuth())
    const headers = new Headers()

    adapter.setAuthCookie(headers, 'abc123')
    expect(headers.get('set-cookie')).toBe(
      'fs_token=abc123; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax',
    )
  })

  it('takes name, secure, sameSite and maxAge from the options', () => {
    const adapter = createFetchAdapter(fakeAuth(), {
      authCookie: 'sid',
      secure: false,
      sameSite: 'strict',
      maxAge: 3600,
    })
    const headers = new Headers()

    adapter.setAuthCookie(headers, 'abc123')
    expect(headers.get('set-cookie')).toBe(
      'sid=abc123; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict',
    )
  })

  it('takes secure and maxAge per call over the options', () => {
    const adapter = createFetchAdapter(fakeAuth(), { secure: false, maxAge: 3600 })
    const headers = new Headers()

    adapter.setAuthCookie(headers, 'abc123', { secure: true, maxAge: 60 })
    expect(headers.get('set-cookie')).toBe(
      'fs_token=abc123; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
    )
  })

  it('appends: a cookie already on the headers stays its own header', () => {
    const adapter = createFetchAdapter(fakeAuth())
    const headers = new Headers()
    headers.append('Set-Cookie', 'theme=dark; Path=/')

    adapter.setAuthCookie(headers, 'abc123')
    expect(headers.getSetCookie()).toHaveLength(2)
    expect(headers.getSetCookie()[0]).toBe('theme=dark; Path=/')
  })
})

describe('clearAuthCookie', () => {
  it('writes a cookie that expires at once, with the same attributes', () => {
    const adapter = createFetchAdapter(fakeAuth(), { sameSite: 'strict' })
    const headers = new Headers()

    adapter.clearAuthCookie(headers)
    expect(headers.get('set-cookie')).toBe(
      'fs_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    )
  })

  it('takes secure per call', () => {
    const adapter = createFetchAdapter(fakeAuth())
    const headers = new Headers()

    adapter.clearAuthCookie(headers, { secure: false })
    expect(headers.get('set-cookie')).toBe('fs_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')
  })
})

// ── isSameOrigin ───────────────────────────────────────────────────────────────

describe('isSameOrigin', () => {
  const url = 'https://app.example.com/api/items'

  it('accepts an Origin equal to the origin of the request URL', () => {
    expect(isSameOrigin(request({ origin: 'https://app.example.com' }, url, 'POST'))).toBe(true)
  })

  it('refuses another origin, scheme or port, and the opaque origin', () => {
    for (const origin of [
      'https://evil.example',
      'http://app.example.com',
      'https://app.example.com:8443',
      'https://sub.app.example.com',
      'null',
    ]) {
      expect(isSameOrigin(request({ origin }, url, 'POST'))).toBe(false)
    }
  })

  it('accepts an origin on the allow-list', () => {
    const allowed = ['https://www.example.com']
    expect(isSameOrigin(request({ origin: 'https://www.example.com' }, url, 'POST'), allowed)).toBe(
      true,
    )
    expect(isSameOrigin(request({ origin: 'https://evil.example' }, url, 'POST'), allowed)).toBe(
      false,
    )
  })

  it('Origin decides when both headers are present', () => {
    const headers = { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }
    expect(isSameOrigin(request(headers, url, 'POST'))).toBe(false)

    const listed = { origin: 'https://www.example.com', 'sec-fetch-site': 'same-site' }
    expect(isSameOrigin(request(listed, url, 'POST'), ['https://www.example.com'])).toBe(true)
  })

  it('falls back to Sec-Fetch-Site without an Origin', () => {
    expect(isSameOrigin(request({ 'sec-fetch-site': 'same-origin' }, url))).toBe(true)
    expect(isSameOrigin(request({ 'sec-fetch-site': 'none' }, url))).toBe(true)
    expect(isSameOrigin(request({ 'sec-fetch-site': 'same-site' }, url))).toBe(false)
    expect(isSameOrigin(request({ 'sec-fetch-site': 'cross-site' }, url))).toBe(false)
  })

  it('refuses a request with neither header', () => {
    expect(isSameOrigin(request({}, url, 'POST'))).toBe(false)
  })
})

// ── isSecureRequest ────────────────────────────────────────────────────────────

describe('isSecureRequest', () => {
  it('reads the scheme of the request URL', () => {
    expect(isSecureRequest(request({}, 'https://app.example.com/'))).toBe(true)
    expect(isSecureRequest(request({}, 'http://localhost:8788/'))).toBe(false)
  })

  it('reads the first x-forwarded-proto value behind a proxy', () => {
    const url = 'http://127.0.0.1:3000/'
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'https' }, url))).toBe(true)
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'HTTPS, http' }, url))).toBe(true)
    expect(isSecureRequest(request({ 'x-forwarded-proto': 'http' }, url))).toBe(false)
  })
})
