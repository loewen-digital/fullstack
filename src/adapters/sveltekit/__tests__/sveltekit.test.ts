import { describe, it, expect, vi } from 'vitest'
import { createHandle, getCsrfToken, setAuthCookie, clearAuthCookie, validateForm } from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
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
      set: (name, value) => { cookies.set(name, value) },
      delete: (name) => { cookies.delete(name) },
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

      expect(setCalled).toHaveBeenCalledWith('fsid', expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }))
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
      const handle = createHandle({ session: createSession({ driver: 'cookie', secret }), security })
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

      for (const bad of [`${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${sig}`, payload]) {
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
      const security = createSecurity()

      let token = ''
      const event1 = makeEvent()
      await run(event1, () => {}, security)
      token = await getCsrfToken(event1.locals, security)

      const event2 = makeEvent({
        request: new Request('http://localhost/', { method: 'POST', headers: { 'x-csrf-token': token } }),
      })
      event2.cookies.set('fsid', event1.cookies.get('fsid')!, { path: '/' })
      await run(event2, () => {}, security)

      expect(event2.locals.csrfVerified).toBe(true)
    })
  })

  describe('CSRF protection', () => {
    it('allows GET requests without CSRF token', async () => {
      const security = createSecurity()
      const handle = createHandle({ security })
      const event = makeEvent({
        request: new Request('http://localhost/', { method: 'GET' }),
      })
      const resolve = makeResolve()

      const response = await handle({ event, resolve })
      expect(response.status).toBe(200)
    })

    it('marks CSRF as unverified when POST has no token', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })
      const handle = createHandle({ security, session })
      const event = makeEvent({
        request: new Request('http://localhost/', { method: 'POST' }),
      })

      await handle({ event, resolve: makeResolve() })

      expect(event.locals.csrfVerified).toBe(false)
    })

    it('verifies CSRF token from x-csrf-token header', async () => {
      const security = createSecurity()
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

describe('getCsrfToken', () => {
  it('generates a CSRF token for the session', async () => {
    const security = createSecurity()
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
