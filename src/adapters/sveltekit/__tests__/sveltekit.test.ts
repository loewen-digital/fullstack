import { describe, it, expect, vi, beforeEach, afterEach } from 'vite-plus/test'
import {
  createHandle,
  getCsrfToken,
  setAuthCookie,
  clearAuthCookie,
  validateForm,
} from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
import type { AuthInstance, AuthSession } from '../../../auth/index.js'
import { createBilling, createMemoryBillingStore } from '../../../billing/index.js'
import { createFakeBillingDriver } from '../../../testing/index.js'
import type { FullstackLocals, SvelteKitRequestEvent, SvelteKitResolve } from '../types.js'

// ── Test helpers ───────────────────────────────────────────────────────────

type TestEvent = SvelteKitRequestEvent & { locals: FullstackLocals }

function makeEvent(overrides: Partial<SvelteKitRequestEvent> = {}): TestEvent {
  const cookies = new Map<string, string>()

  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    locals: {},
    route: { id: null },
    cookies: {
      get: (name) => cookies.get(name),
      set: (name, value) => {
        cookies.set(name, value)
      },
      delete: (name) => {
        cookies.delete(name)
      },
    },
    ...overrides,
  }
}

function makeResolve(response = new Response('ok')): SvelteKitResolve {
  return vi.fn().mockResolvedValue(response)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('createHandle (SvelteKit adapter)', () => {
  describe('session integration', () => {
    it('loads session and sets it on locals', async () => {
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ session })
      const event = makeEvent()
      const resolve = makeResolve()

      await handle({ event, resolve })

      expect(event.locals.session).toBeDefined()
      expect(resolve).toHaveBeenCalledOnce()
    })

    it('persists session data across requests via cookie', async () => {
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ session })

      // First request — set a value
      const event1 = makeEvent()
      await handle({
        event: event1,
        resolve: async (e) => {
          const s = (e.locals as FullstackLocals).session!
          s.set('userId', 42)
          return new Response('ok')
        },
      })

      const sessionId = event1.cookies.get('fsid')
      expect(sessionId).toBeDefined()

      // Second request — read the value using the session cookie
      const event2 = makeEvent()
      event2.cookies.set('fsid', sessionId!, { path: '/' })

      await handle({
        event: event2,
        resolve: async (e) => {
          const s = (e.locals as FullstackLocals).session!
          expect(s.get('userId')).toBe(42)
          return new Response('ok')
        },
      })
    })

    it('memory driver keeps only the session id in the cookie', async () => {
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ session })
      const event = makeEvent()

      await handle({ event, resolve: makeResolve() })

      expect(event.cookies.get('fsid')).toBe(event.locals.session!.id)
    })

    it('sets session cookie with httpOnly and sameSite', async () => {
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ session })
      const event = makeEvent()
      const setCalled = vi.fn()

      // Intercept cookie.set to check options
      const origSet = event.cookies.set.bind(event.cookies)
      event.cookies.set = (name, value, opts) => {
        setCalled(name, opts)
        origSet(name, value, opts)
      }

      await handle({ event, resolve: makeResolve() })

      expect(setCalled).toHaveBeenCalledWith(
        'fsid',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
        }),
      )
    })
  })

  describe('cookie session driver', () => {
    const secret = 'test-secret'

    async function run(
      event: TestEvent,
      inside: (session: FullstackLocals['session'] & object) => void,
      security?: ReturnType<typeof createSecurity>,
    ): Promise<void> {
      // A fresh createSession per request: another process, or another Workers isolate
      const handle = createHandle({
        session: createSession({ driver: 'cookie', secret }),
        security,
      })
      await handle({
        event,
        resolve: async (e) => {
          inside((e.locals as FullstackLocals).session!)
          return new Response('ok')
        },
      })
    }

    it('carries flash and old input in the cookie: a fresh instance reads them from the cookies alone', async () => {
      const event1 = makeEvent()
      await run(event1, (s) => {
        s.flash('notice', 'Welcome back')
        s.flashInput({ email: 'a@example.com' })
      })
      const cookie = event1.cookies.get('fsid')
      expect(cookie).toBeDefined()
      expect(cookie).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

      const event2 = makeEvent()
      event2.cookies.set('fsid', cookie!, { path: '/' })
      let seen: Record<string, unknown> = {}
      await run(event2, (s) => {
        seen = { notice: s.getFlash('notice'), email: s.getOldInput('email') }
      })
      expect(seen).toEqual({ notice: 'Welcome back', email: 'a@example.com' })

      const event3 = makeEvent()
      event3.cookies.set('fsid', event2.cookies.get('fsid')!, { path: '/' })
      await run(event3, (s) => {
        seen = { notice: s.getFlash('notice'), email: s.getOldInput('email') }
      })
      expect(seen).toEqual({ notice: undefined, email: undefined })
    })

    it('treats a tampered or unsigned cookie as no session and replaces it', async () => {
      const event1 = makeEvent()
      await run(event1, (s) => s.set('role', 'admin'))
      const cookie = event1.cookies.get('fsid')!
      const [payload, sig] = cookie.split('.') as [string, string]

      for (const bad of [
        `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${sig}`,
        payload,
      ]) {
        const event2 = makeEvent()
        event2.cookies.set('fsid', bad, { path: '/' })
        let role: unknown = 'unset'
        await run(event2, (s) => {
          role = s.get('role')
        })
        expect(role).toBeUndefined()
        expect(event2.cookies.get('fsid')).not.toBe(bad)
      }
    })

    it('keeps the session id stable, so CSRF tokens verify on the next request', async () => {
      const security = createSecurity({ csrf: { secret: 'test-secret' } })

      let token = ''
      const event1 = makeEvent()
      await run(event1, () => {}, security)
      token = await getCsrfToken(event1.locals, security)

      const event2 = makeEvent({
        request: new Request('http://localhost/', {
          method: 'POST',
          headers: { 'x-csrf-token': token },
        }),
      })
      event2.cookies.set('fsid', event1.cookies.get('fsid')!, { path: '/' })
      await run(event2, () => {}, security)

      expect(event2.locals.csrfVerified).toBe(true)
    })
  })

  describe('CSRF protection', () => {
    it('allows GET requests without CSRF token', async () => {
      const security = createSecurity({ csrf: { secret: 'test-secret' } })
      const handle = createHandle({ security })
      const event = makeEvent({
        request: new Request('http://localhost/', { method: 'GET' }),
      })
      const resolve = makeResolve()

      const response = await handle({ event, resolve })
      expect(response.status).toBe(200)
    })

    it('marks CSRF as unverified when POST has no token', async () => {
      const security = createSecurity({ csrf: { secret: 'test-secret' } })
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ security, session })
      const event = makeEvent({
        request: new Request('http://localhost/', { method: 'POST' }),
      })

      await handle({ event, resolve: makeResolve() })

      expect(event.locals.csrfVerified).toBe(false)
    })

    it('verifies CSRF token from x-csrf-token header', async () => {
      const security = createSecurity({ csrf: { secret: 'test-secret' } })
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ security, session })

      // Pre-load a session to get a session ID
      const sessionHandle = await session.load()
      await sessionHandle.save()
      const sessionId = sessionHandle.id

      const token = await security.generateCsrfToken(sessionId)

      const event = makeEvent({
        request: new Request('http://localhost/', {
          method: 'POST',
          headers: { 'x-csrf-token': token },
        }),
      })
      event.cookies.set('fsid', sessionId, { path: '/' })

      await handle({ event, resolve: makeResolve() })

      expect(event.locals.csrfVerified).toBe(true)
    })
  })

  describe('no stack modules', () => {
    it('passes through with empty stack', async () => {
      const handle = createHandle({})
      const event = makeEvent()
      const resolve = makeResolve(new Response('hello'))

      const response = await handle({ event, resolve })
      expect(response.status).toBe(200)
    })
  })

  describe('custom cookie names', () => {
    it('respects custom sessionCookie option', async () => {
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ session }, { sessionCookie: 'my_session' })
      const event = makeEvent()
      await handle({ event, resolve: makeResolve() })
      expect(event.cookies.get('my_session')).toBeDefined()
    })
  })
})

describe('entitlements on locals', () => {
  const SESSION: AuthSession = {
    id: 's1',
    userId: 7,
    token: 'valid-token',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
  }
  const auth = {
    validateSession: async (token: string) => (token === SESSION.token ? SESSION : null),
  } as unknown as AuthInstance

  function paidBilling() {
    const driver = createFakeBillingDriver()
    const store = createMemoryBillingStore()
    const billing = createBilling({
      driver,
      store,
      products: { pro: { type: 'subscription', providerId: 'pri_pro', features: ['export'] } },
    })
    const paid = (userId: string) =>
      billing.handleWebhook(
        driver.webhook({ type: 'subscription.started', userId, providerId: 'pri_pro' }),
      )
    return { billing, store, paid }
  }

  async function run(
    handle: ReturnType<typeof createHandle>,
    event: TestEvent,
    route: (locals: FullstackLocals) => Promise<void> = async () => {},
  ) {
    await handle({
      event,
      resolve: async (e) => {
        await route(e.locals as FullstackLocals)
        return new Response('ok')
      },
    })
  }

  it('is not there unless billing is in the stack', async () => {
    const event = makeEvent()
    await run(createHandle({ auth }), event)
    expect(event.locals.entitlements).toBeUndefined()
  })

  it('resolves what the signed-in user paid for, with one store read per request', async () => {
    const { billing, store, paid } = paidBilling()
    await paid('7')
    const reads = vi.spyOn(store, 'getAccount')
    const handle = createHandle({ auth, billing })
    const event = makeEvent()
    event.cookies.set('fs_token', 'valid-token', { path: '/' })

    await run(handle, event, async (locals) => {
      // Nothing is read before a route asks.
      expect(reads).not.toHaveBeenCalled()
      const first = await locals.entitlements!()
      const second = await locals.entitlements!()
      expect(first?.userId).toBe('7')
      expect(first?.has('export')).toBe(true)
      expect(second).toBe(first)
    })

    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('answers null for a visitor who is not signed in, without a store read', async () => {
    const { billing, store } = paidBilling()
    const reads = vi.spyOn(store, 'getAccount')
    const event = makeEvent()

    await run(createHandle({ auth, billing }), event, async (locals) => {
      expect(await locals.entitlements!()).toBeNull()
    })

    expect(reads).not.toHaveBeenCalled()
  })

  it('resolves for the subject `entitlementsFor` names, without the auth module', async () => {
    const { billing, paid } = paidBilling()
    await paid('site_1')
    const handle = createHandle(
      { billing },
      { entitlementsFor: (event) => event.url.searchParams.get('site') },
    )

    const site = makeEvent({ url: new URL('http://localhost/?site=site_1') })
    await run(handle, site, async (locals) => {
      expect((await locals.entitlements!())?.has('export')).toBe(true)
    })
    const other = makeEvent({ url: new URL('http://localhost/?site=site_2') })
    await run(handle, other, async (locals) => {
      expect((await locals.entitlements!())?.has('export')).toBe(false)
    })
    const none = makeEvent()
    await run(handle, none, async (locals) => {
      expect(await locals.entitlements!()).toBeNull()
    })
  })
})

describe('getCsrfToken', () => {
  it('generates a CSRF token for the session', async () => {
    const security = createSecurity({ csrf: { secret: 'test-secret' } })
    const session = createSession({ driver: 'memory' })
    const sessionHandle = await session.load()

    const token = await getCsrfToken({ session: sessionHandle }, security)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
  })
})

describe('setAuthCookie / clearAuthCookie', () => {
  it('sets auth cookie with correct options', () => {
    const event = makeEvent()
    setAuthCookie(event, 'my-token-123')
    expect(event.cookies.get('fs_token')).toBe('my-token-123')
  })

  it('clears auth cookie', () => {
    const event = makeEvent()
    event.cookies.set('fs_token', 'some-token', { path: '/' })
    clearAuthCookie(event)
    expect(event.cookies.get('fs_token')).toBeUndefined()
  })

  it('respects custom authCookie name', () => {
    const event = makeEvent()
    setAuthCookie(event, 'tok', { authCookie: 'custom_auth' })
    expect(event.cookies.get('custom_auth')).toBe('tok')
    clearAuthCookie(event, { authCookie: 'custom_auth' })
    expect(event.cookies.get('custom_auth')).toBeUndefined()
  })
})

describe('validateForm', () => {
  it('returns validated data on success', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    })

    const result = await validateForm(req, undefined, {
      name: 'required|string',
      email: 'required|email',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.name).toBe('Alice')
    }
  })

  it('returns errors on validation failure', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    const result = await validateForm(req, undefined, {
      name: 'required|string',
      email: 'required|email',
    })

    expect(result.ok).toBe(false)
  })

  it('flashes errors and old input to session on failure', async () => {
    const session = createSession({ driver: 'memory' })
    const sessionHandle = await session.load()

    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    await validateForm(req, sessionHandle, {
      email: 'required|email',
    })

    // Flash is stored in __flash_new__ and rotated on the next session.load()
    await sessionHandle.save()
    const nextHandle = await session.load(sessionHandle.id)
    const errors = nextHandle.getFlash('_errors')
    expect(errors).toBeDefined()
  })
})

// ── auth: the validated session is exposed, no user object (#9) ───────────────

describe('auth integration', () => {
  const authSession: AuthSession = {
    id: 's1',
    userId: 'u1',
    token: 'good',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  }
  const auth = {
    validateSession: async (token: string) => (token === 'good' ? authSession : null),
  } as unknown as AuthInstance

  it('puts the validated session on locals and no user object', async () => {
    const handle = createHandle({ auth })
    const event = makeEvent()
    event.cookies.set('fs_token', 'good', { path: '/' })
    await handle({ event, resolve: makeResolve() })
    expect(event.locals.authSession).toEqual(authSession)
    expect('user' in event.locals).toBe(false)
  })

  it('sets authSession to null without a valid cookie', async () => {
    const handle = createHandle({ auth })
    const event = makeEvent()
    await handle({ event, resolve: makeResolve() })
    expect(event.locals.authSession).toBeNull()
    expect('user' in event.locals).toBe(false)
  })
})

describe('auth cookie of an extended session', () => {
  const NOW = new Date('2026-01-01T00:00:00.000Z')
  const session: AuthSession = {
    id: 's1',
    userId: 'u1',
    token: 'good',
    expiresAt: new Date('2026-01-31T00:00:00.000Z'),
    createdAt: new Date('2025-12-20T00:00:00.000Z'),
  }

  function touchingAuth(extended: boolean) {
    return {
      validateSession: async (): Promise<AuthSession | null> => {
        throw new Error('the handle has to ask touchSession')
      },
      touchSession: async (token: string) =>
        token === 'good' ? { session, extended } : { session: null, extended: false },
    }
  }

  /** An event that carries the auth cookie and records every `cookies.set` from here on. */
  function eventWith(cookie: string, value: string, url = 'https://app.example.com/') {
    const event = makeEvent({ url: new URL(url), request: new Request(url) })
    event.cookies.set(cookie, value, { path: '/' })
    const set = vi.spyOn(event.cookies, 'set')
    return { event, set }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the cookie again, alive until the session ends', async () => {
    const { event, set } = eventWith('fs_token', 'good')

    await createHandle({ auth: touchingAuth(true) })({ event, resolve: makeResolve() })

    expect(event.locals.authSession).toEqual(session)
    expect(set).toHaveBeenCalledExactlyOnceWith('fs_token', 'good', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 30 * 24 * 3600,
    })
  })

  it('uses the configured cookie name and the scheme of the request', async () => {
    const { event, set } = eventWith('sid', 'good', 'http://localhost:5173/')

    await createHandle(
      { auth: touchingAuth(true) },
      { authCookie: 'sid' },
    )({
      event,
      resolve: makeResolve(),
    })

    expect(set).toHaveBeenCalledExactlyOnceWith(
      'sid',
      'good',
      expect.objectContaining({ secure: false, maxAge: 30 * 24 * 3600 }),
    )
  })

  it('leaves the cookie alone when the session was not extended or is unknown', async () => {
    const still = eventWith('fs_token', 'good')
    await createHandle({ auth: touchingAuth(false) })({
      event: still.event,
      resolve: makeResolve(),
    })
    expect(still.event.locals.authSession).toEqual(session)
    expect(still.set).not.toHaveBeenCalled()

    const unknown = eventWith('fs_token', 'stale')
    await createHandle({ auth: touchingAuth(true) })({
      event: unknown.event,
      resolve: makeResolve(),
    })
    expect(unknown.event.locals.authSession).toBeNull()
    expect(unknown.set).not.toHaveBeenCalled()
  })

  it('a logout in the route still clears the cookie', async () => {
    const { event } = eventWith('fs_token', 'good')

    await createHandle({ auth: touchingAuth(true) })({
      event,
      resolve: async (e) => {
        clearAuthCookie(e)
        return new Response('bye')
      },
    })

    expect(event.cookies.get('fs_token')).toBeUndefined()
  })
})
