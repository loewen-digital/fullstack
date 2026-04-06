import { describe, it, expect, vi } from 'vitest'
import { createHandle, getCsrfToken, setAuthCookie, clearAuthCookie, validateForm } from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
import type { SvelteKitRequestEvent, SvelteKitResolve } from '../types.js'

// ── Test helpers ───────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<SvelteKitRequestEvent> = {}): SvelteKitRequestEvent {
  const cookies = new Map<string, string>()

  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    locals: {},
    route: { id: null },
    cookies: {
      get: (name) => cookies.get(name),
      getAll: () => [...cookies.entries()].map(([name, value]) => ({ name, value })),
      set: (name, value) => { cookies.set(name, value) },
      delete: (name) => { cookies.delete(name) },
      serialize: (name, value) => `${name}=${value}`,
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
          const s = e.locals.session as Awaited<ReturnType<typeof session.load>>
          s.set('userId', 42)
          return new Response('ok')
        },
      })

      const sessionId = event1.cookies.get('fsid')
      expect(sessionId).toBeDefined()

      // Second request — read the value using the session cookie
      const event2 = makeEvent()
      event2.cookies.set('fsid', sessionId!)

      await handle({
        event: event2,
        resolve: async (e) => {
          const s = e.locals.session as Awaited<ReturnType<typeof session.load>>
          expect(s.get('userId')).toBe(42)
          return new Response('ok')
        },
      })
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
      event.cookies.set('fsid', sessionId)

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
    event.cookies.set('fs_token', 'some-token')
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
