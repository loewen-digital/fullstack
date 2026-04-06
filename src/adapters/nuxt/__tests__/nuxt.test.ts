import { describe, it, expect } from 'vitest'
import {
  createNuxtMiddleware,
  getCsrfToken,
  setAuthCookie,
  clearAuthCookie,
} from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
import type { H3Event } from '../types.js'

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<{
  method: string
  path: string
  headers: Record<string, string>
}> = {}): H3Event & { _responseCookies: string[] } {
  const responseCookies: string[] = []
  const headers = overrides.headers ?? {}

  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/',
    context: {},
    node: {
      req: {
        method: overrides.method ?? 'GET',
        url: overrides.path ?? '/',
        headers,
      },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          if (name.toLowerCase() === 'set-cookie') {
            responseCookies.push(value)
          }
        },
        getHeader(name: string) {
          if (name.toLowerCase() === 'set-cookie') {
            return responseCookies.length > 0 ? responseCookies : undefined
          }
          return undefined
        },
      },
    },
    _responseCookies: responseCookies,
  }
}

function getSetCookies(event: ReturnType<typeof makeEvent>): string[] {
  return event._responseCookies.flatMap((v) => v.split(', '))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('createNuxtMiddleware', () => {
  describe('session integration', () => {
    it('loads session and sets it on event.context', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createNuxtMiddleware({ session })
      const event = makeEvent()

      await middleware(event)

      expect(event.context.session).toBeDefined()
    })

    it('sets session cookie in response when new session is created', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createNuxtMiddleware({ session })
      const event = makeEvent()

      await middleware(event)

      const cookies = getSetCookies(event)
      const sessionCookie = cookies.find((c) => c.startsWith('fsid='))
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie).toContain('HttpOnly')
      expect(sessionCookie).toContain('SameSite=Lax')
    })

    it('respects custom sessionCookie name', async () => {
      const session = createSession({ driver: 'memory' })
      const middleware = createNuxtMiddleware({ session }, { sessionCookie: 'my_sess' })
      const event = makeEvent()

      await middleware(event)

      const cookies = getSetCookies(event)
      expect(cookies.some((c) => c.startsWith('my_sess='))).toBe(true)
    })

    it('loads existing session from cookie', async () => {
      const session = createSession({ driver: 'memory' })

      // Create a session and store data in it
      const initial = await session.load()
      initial.set('key', 'value')
      await initial.save()

      const middleware = createNuxtMiddleware({ session })
      const event = makeEvent({
        headers: { cookie: `fsid=${initial.id}` },
      })

      await middleware(event)

      const loaded = event.context.session as Awaited<ReturnType<typeof session.load>>
      expect(loaded.get('key')).toBe('value')
    })
  })

  describe('CSRF protection', () => {
    it('allows GET requests without CSRF token', async () => {
      const security = createSecurity()
      const middleware = createNuxtMiddleware({ security })
      const event = makeEvent({ method: 'GET' })

      // Should not throw
      await expect(middleware(event)).resolves.toBeUndefined()
    })

    it('marks CSRF as unverified when POST has no token', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })
      const middleware = createNuxtMiddleware({ security, session })
      const event = makeEvent({ method: 'POST' })

      await middleware(event)

      expect(event.context.csrfVerified).toBe(false)
    })

    it('verifies CSRF token from x-csrf-token header', async () => {
      const security = createSecurity()
      const session = createSession({ driver: 'memory' })

      const sessionHandle = await session.load()
      await sessionHandle.save()
      const sessionId = sessionHandle.id

      const token = await security.generateCsrfToken(sessionId)
      const middleware = createNuxtMiddleware({ security, session })
      const event = makeEvent({
        method: 'POST',
        headers: {
          cookie: `fsid=${sessionId}`,
          'x-csrf-token': token,
        },
      })

      await middleware(event)

      expect(event.context.csrfVerified).toBe(true)
    })

    it('skips CSRF for exempt paths', async () => {
      const security = createSecurity()
      const middleware = createNuxtMiddleware(
        { security },
        { csrfExemptPaths: ['/api/webhooks'] },
      )
      const event = makeEvent({ method: 'POST', path: '/api/webhooks/stripe' })

      await middleware(event)

      expect(event.context.csrfVerified).toBe(true)
    })
  })

  describe('empty stack', () => {
    it('passes through with no modules configured', async () => {
      const middleware = createNuxtMiddleware({})
      const event = makeEvent()
      await expect(middleware(event)).resolves.toBeUndefined()
    })
  })
})

describe('getCsrfToken', () => {
  it('generates a token for the current session', async () => {
    const security = createSecurity()
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()

    const token = await getCsrfToken({ session: handle }, security)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
  })

  it('generates a token when no session is present', async () => {
    const security = createSecurity()
    const token = await getCsrfToken({}, security)
    expect(typeof token).toBe('string')
  })
})

describe('setAuthCookie / clearAuthCookie', () => {
  it('sets auth cookie with correct options', () => {
    const event = makeEvent()
    setAuthCookie(event, 'my-token-abc')

    const cookies = getSetCookies(event)
    const authCookie = cookies.find((c) => c.startsWith('fs_token='))
    expect(authCookie).toBeDefined()
    expect(authCookie).toContain('HttpOnly')
    expect(authCookie).toContain('Max-Age=604800')
  })

  it('clears auth cookie by setting Max-Age=0', () => {
    const event = makeEvent()
    clearAuthCookie(event)

    const cookies = getSetCookies(event)
    const cleared = cookies.find((c) => c.startsWith('fs_token='))
    expect(cleared).toBeDefined()
    expect(cleared).toContain('Max-Age=0')
  })

  it('respects custom authCookie name', () => {
    const event = makeEvent()
    setAuthCookie(event, 'tok', { authCookie: 'custom_auth' })

    const cookies = getSetCookies(event)
    expect(cookies.some((c) => c.startsWith('custom_auth='))).toBe(true)
  })

  it('clears custom-named auth cookie', () => {
    const event = makeEvent()
    clearAuthCookie(event, { authCookie: 'custom_auth' })

    const cookies = getSetCookies(event)
    const cleared = cookies.find((c) => c.startsWith('custom_auth='))
    expect(cleared).toContain('Max-Age=0')
  })
})

describe('cookie parsing', () => {
  it('parses multiple cookies from header', async () => {
    const session = createSession({ driver: 'memory' })

    const initial = await session.load()
    initial.set('ping', 'pong')
    await initial.save()

    const middleware = createNuxtMiddleware({ session })
    const event = makeEvent({
      headers: { cookie: `other=abc; fsid=${initial.id}; another=xyz` },
    })

    await middleware(event)

    const loaded = event.context.session as Awaited<ReturnType<typeof session.load>>
    expect(loaded.get('ping')).toBe('pong')
  })
})

describe('HEAD and OPTIONS bypass CSRF', () => {
  it.each(['HEAD', 'OPTIONS'])('%s requests skip CSRF check', async (method) => {
    const security = createSecurity()
    const middleware = createNuxtMiddleware({ security })
    const event = makeEvent({ method })

    await middleware(event)

    // csrfVerified should not be set since CSRF check is skipped for safe methods
    expect(event.context.csrfVerified).toBeUndefined()
  })
})
