import { describe, it, expect, vi } from 'vitest'
import {
  createAstroMiddleware,
  getCsrfToken,
  setAuthCookie,
  clearAuthCookie,
  validateBody,
} from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
import type { AstroAPIContext, AstroMiddlewareNext } from '../types.js'

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeCookies(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const deletions = new Set<string>()

  return {
    store,
    deletions,
    get: (key: string) => {
      const value = store.get(key)
      return value !== undefined ? { value } : undefined
    },
    has: (key: string) => store.has(key),
    set: (key: string, value: string, _opts?: unknown) => {
      store.set(key, value)
    },
    delete: (key: string, _opts?: unknown) => {
      store.delete(key)
      deletions.add(key)
    },
    headers: () => [] as string[],
  }
}

function makeContext(overrides: {
  method?: string
  url?: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
} = {}): AstroAPIContext & { cookies: ReturnType<typeof makeCookies> } {
  const url = new URL(overrides.url ?? 'http://localhost/')
  const cookies = makeCookies(overrides.cookies ?? {})

  return {
    request: new Request(url.toString(), {
      method: overrides.method ?? 'GET',
      headers: overrides.headers ?? {},
    }),
    url,
    params: {},
    locals: {},
    cookies,
    site: undefined,
    generator: 'test',
  }
}

function makeNext(response = new Response('ok')): AstroMiddlewareNext {
  return vi.fn().mockResolvedValue(response)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createAstroMiddleware', () => {
  describe('session integration', () => {
    it('loads session and sets it on locals', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createAstroMiddleware({ session })
      const context = makeContext()

      await middleware(context, makeNext())

      expect(context.locals.session).toBeDefined()
    })

    it('persists session and sets cookie in response', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createAstroMiddleware({ session })
      const context = makeContext()

      await middleware(context, makeNext())

      expect(context.cookies.store.has('fsid')).toBe(true)
    })

    it('loads existing session from cookie', async () => {
      const session = createSession({ driver: 'memory' })

      const initial = await session.load()
      initial.set('ping', 'pong')
      await initial.save()

      const middleware = createAstroMiddleware({ session })
      const context = makeContext({ cookies: { fsid: initial.id } })

      await middleware(context, makeNext())

      const loaded = context.locals.session as Awaited<ReturnType<typeof session.load>>
      expect(loaded.get('ping')).toBe('pong')
    })

    it('respects custom sessionCookie name', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createAstroMiddleware({ session }, { sessionCookie: 'my_sess' })
      const context = makeContext()

      await middleware(context, makeNext())

      expect(context.cookies.store.has('my_sess')).toBe(true)
    })

    it('does not set session cookie when ID already matches', async () => {
      const session = createSession({ driver: 'memory' })
      const initial = await session.load()
      await initial.save()

      const middleware = createAstroMiddleware({ session })
      const context = makeContext({ cookies: { fsid: initial.id } })

      // Track set calls after setup
      const setCalled = vi.spyOn(context.cookies, 'set')
      await middleware(context, makeNext())

      // Should not have set the fsid cookie since it already matches
      const fsidSets = setCalled.mock.calls.filter(([key]) => key === 'fsid')
      expect(fsidSets).toHaveLength(0)
    })
  })

  describe('CSRF protection', () => {
    it('allows GET requests without CSRF token', async () => {
      const security = createSecurity()
      const middleware = createAstroMiddleware({ security })
      const context = makeContext({ method: 'GET' })
      const next = makeNext()

      const response = await middleware(context, next)
      expect(response.status).toBe(200)
      expect(next).toHaveBeenCalled()
    })

    it('marks csrfVerified false for POST without token', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })
      const middleware = createAstroMiddleware({ security, session })
      const context = makeContext({ method: 'POST' })

      await middleware(context, makeNext())

      expect(context.locals.csrfVerified).toBe(false)
    })

    it('marks csrfVerified true for POST with valid token', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })

      const sessionHandle = await session.load()
      await sessionHandle.save()
      const sessionId = sessionHandle.id
      const token = await security.generateCsrfToken(sessionId)

      const middleware = createAstroMiddleware({ security, session })
      const context = makeContext({
        method: 'POST',
        cookies: { fsid: sessionId },
        headers: { 'x-csrf-token': token },
      })

      await middleware(context, makeNext())

      expect(context.locals.csrfVerified).toBe(true)
    })

    it('marks csrfVerified true for x-xsrf-token header', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })

      const sessionHandle = await session.load()
      await sessionHandle.save()
      const token = await security.generateCsrfToken(sessionHandle.id)

      const middleware = createAstroMiddleware({ security, session })
      const context = makeContext({
        method: 'PUT',
        cookies: { fsid: sessionHandle.id },
        headers: { 'x-xsrf-token': token },
      })

      await middleware(context, makeNext())

      expect(context.locals.csrfVerified).toBe(true)
    })

    it('skips CSRF for exempt paths', async () => {
      const security = createSecurity()
      const middleware = createAstroMiddleware(
        { security },
        { csrfExemptPaths: ['/api/webhooks'] },
      )
      const context = makeContext({
        method: 'POST',
        url: 'http://localhost/api/webhooks/stripe',
      })

      await middleware(context, makeNext())

      expect(context.locals.csrfVerified).toBe(true)
    })

    it('does not set csrfVerified for safe methods', async () => {
      const security = createSecurity()
      const middleware = createAstroMiddleware({ security })

      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const context = makeContext({ method })
        await middleware(context, makeNext())
        expect(context.locals.csrfVerified).toBeUndefined()
      }
    })
  })

  describe('empty stack', () => {
    it('passes through cleanly', async () => {
      const middleware = createAstroMiddleware({})
      const context = makeContext()
      const next = makeNext(new Response('hello'))

      const response = await middleware(context, next)
      expect(response.status).toBe(200)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('next() is always called', () => {
    it('calls next even when CSRF fails', async () => {
      const security = createSecurity()
      const middleware = createAstroMiddleware({ security })
      const context = makeContext({ method: 'POST' })
      const next = makeNext()

      await middleware(context, next)
      expect(next).toHaveBeenCalled()
    })
  })
})

// ── getCsrfToken ───────────────────────────────────────────────────────────────

describe('getCsrfToken', () => {
  it('generates a token from session', async () => {
    const security = createSecurity()
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()

    const token = await getCsrfToken({ session: handle }, security)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
  })

  it('generates a token without session', async () => {
    const security = createSecurity()
    const token = await getCsrfToken({}, security)
    expect(typeof token).toBe('string')
  })
})

// ── setAuthCookie / clearAuthCookie ───────────────────────────────────────────

describe('setAuthCookie / clearAuthCookie', () => {
  it('sets auth cookie with correct options', () => {
    const context = makeContext()
    setAuthCookie(context, 'my-token-123')

    expect(context.cookies.store.get('fs_token')).toBe('my-token-123')
  })

  it('clears auth cookie', () => {
    const context = makeContext({ cookies: { fs_token: 'existing-token' } })
    clearAuthCookie(context)

    expect(context.cookies.store.has('fs_token')).toBe(false)
    expect(context.cookies.deletions.has('fs_token')).toBe(true)
  })

  it('respects custom authCookie name', () => {
    const context = makeContext()
    setAuthCookie(context, 'tok', { authCookie: 'my_auth' })

    expect(context.cookies.store.get('my_auth')).toBe('tok')
  })

  it('clears custom-named auth cookie', () => {
    const context = makeContext({ cookies: { my_auth: 'token' } })
    clearAuthCookie(context, { authCookie: 'my_auth' })

    expect(context.cookies.store.has('my_auth')).toBe(false)
  })

  it('respects custom maxAge', () => {
    const context = makeContext()
    const setCalled = vi.spyOn(context.cookies, 'set')

    setAuthCookie(context, 'tok', { maxAge: 3600 })

    expect(setCalled).toHaveBeenCalledWith('fs_token', 'tok', expect.objectContaining({
      maxAge: 3600,
    }))
  })
})

// ── validateBody ──────────────────────────────────────────────────────────────

describe('validateBody', () => {
  it('returns validated data for valid JSON', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    })

    const result = await validateBody(request, undefined, {
      name: 'required|string',
      email: 'required|email',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Alice')
  })

  it('returns errors for invalid data', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    const result = await validateBody(request, undefined, {
      email: 'required|email',
    })

    expect(result.ok).toBe(false)
  })

  it('flashes errors and old input to session on failure', async () => {
    const session = createSession({ driver: 'memory' })
    const sessionHandle = await session.load()

    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    await validateBody(request, sessionHandle, { email: 'required|email' })

    await sessionHandle.save()
    const next = await session.load(sessionHandle.id)
    expect(next.getFlash('_errors')).toBeDefined()
  })
})
