import { describe, it, expect } from 'vitest'
import {
  createRemixLoader,
  createRemixAction,
  withFullstack,
  authCookieHeader,
  clearAuthCookieHeader,
  getCsrfToken,
  validateBody,
} from '../index.js'
import { createSession } from '../../../session/index.js'
import { createSecurity } from '../../../security/index.js'
import type { RemixFunctionArgs } from '../types.js'

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeArgs(overrides: {
  method?: string
  url?: string
  headers?: Record<string, string>
} = {}): RemixFunctionArgs {
  const method = overrides.method ?? 'GET'
  const url = overrides.url ?? 'http://localhost/'

  return {
    request: new Request(url, {
      method,
      headers: overrides.headers ?? {},
    }),
    params: {},
  }
}

// ── createRemixLoader ──────────────────────────────────────────────────────────

describe('createRemixLoader', () => {
  it('injects session into loader args', async () => {
    const session = createSession({ driver: 'memory' })
    const wrap = createRemixLoader({ session })
    const args = makeArgs()

    const loader = wrap(async (fsArgs) => {
      expect(fsArgs.session).toBeDefined()
      return { ok: true }
    })

    await loader(args)
  })

  it('returns loader result', async () => {
    const wrap = createRemixLoader({})
    const loader = wrap(async () => ({ greeting: 'hello' }))

    const result = await loader(makeArgs())
    expect(result).toEqual({ greeting: 'hello' })
  })

  it('loads existing session data from cookie', async () => {
    const session = createSession({ driver: 'memory' })

    const initial = await session.load()
    initial.set('userId', 99)
    await initial.save()

    const wrap = createRemixLoader({ session })
    const args = makeArgs({ headers: { cookie: `fsid=${initial.id}` } })

    const loader = wrap(async (fsArgs) => {
      return fsArgs.session?.get('userId')
    })

    const result = await loader(args)
    expect(result).toBe(99)
  })

  it('commitSession returns Set-Cookie header string', async () => {
    const session = createSession({ driver: 'memory' })
    const wrap = createRemixLoader({ session })

    let cookie: string | undefined
    const loader = wrap(async (fsArgs) => {
      cookie = await fsArgs.commitSession()
      return null
    })

    await loader(makeArgs())

    expect(typeof cookie).toBe('string')
    expect(cookie).toContain('fsid=')
    expect(cookie).toContain('HttpOnly')
  })

  it('respects custom sessionCookie option', async () => {
    const session = createSession({ driver: 'memory' })
    const wrap = createRemixLoader({ session }, { sessionCookie: 'my_sess' })

    let cookie: string | undefined
    const loader = wrap(async (fsArgs) => {
      cookie = await fsArgs.commitSession()
      return null
    })

    await loader(makeArgs())
    expect(cookie).toContain('my_sess=')
  })

  it('does not inject auth fields when auth module not configured', async () => {
    const wrap = createRemixLoader({})
    const loader = wrap(async (fsArgs) => ({
      hasAuth: 'authSession' in fsArgs,
      hasUser: 'user' in fsArgs,
    }))

    const result = await loader(makeArgs())
    expect(result.hasAuth).toBe(false)
    expect(result.hasUser).toBe(false)
  })
})

// ── createRemixAction ──────────────────────────────────────────────────────────

describe('createRemixAction', () => {
  it('injects session into action args', async () => {
    const session = createSession({ driver: 'memory' })
    const wrap = createRemixAction({ session })

    const action = wrap(async (fsArgs) => {
      expect(fsArgs.session).toBeDefined()
      return { saved: true }
    })

    await action(makeArgs({ method: 'POST' }))
  })

  it('marks CSRF as unverified for POST without token', async () => {
    const security = createSecurity()
    const session = createSession({ driver: 'memory' })
    const wrap = createRemixAction({ security, session })

    let verified: boolean | undefined
    const action = wrap(async (fsArgs) => {
      verified = fsArgs.csrfVerified
      return null
    })

    await action(makeArgs({ method: 'POST' }))
    expect(verified).toBe(false)
  })

  it('marks CSRF as verified when valid token provided', async () => {
    const security = createSecurity()
    const session = createSession({ driver: 'memory' })

    const sessionHandle = await session.load()
    await sessionHandle.save()
    const sessionId = sessionHandle.id
    const token = await security.generateCsrfToken(sessionId)

    const wrap = createRemixAction({ security, session })

    let verified: boolean | undefined
    const action = wrap(async (fsArgs) => {
      verified = fsArgs.csrfVerified
      return null
    })

    await action(makeArgs({
      method: 'POST',
      headers: { cookie: `fsid=${sessionId}`, 'x-csrf-token': token },
    }))

    expect(verified).toBe(true)
  })

  it('skips CSRF for exempt paths', async () => {
    const security = createSecurity()
    const wrap = createRemixAction(
      { security },
      { csrfExemptPaths: ['/webhooks'] },
    )

    let verified: boolean | undefined
    const action = wrap(async (fsArgs) => {
      verified = fsArgs.csrfVerified
      return null
    })

    await action(makeArgs({ method: 'POST', url: 'http://localhost/webhooks/stripe' }))
    expect(verified).toBe(true)
  })

  it('GET requests do not set csrfVerified', async () => {
    const security = createSecurity()
    const wrap = createRemixAction({ security })

    let verified: boolean | undefined
    const action = wrap(async (fsArgs) => {
      verified = fsArgs.csrfVerified
      return null
    })

    await action(makeArgs({ method: 'GET' }))
    expect(verified).toBeUndefined()
  })
})

// ── withFullstack ──────────────────────────────────────────────────────────────

describe('withFullstack', () => {
  it('returns enriched args', async () => {
    const session = createSession({ driver: 'memory' })
    const args = makeArgs()

    const fsArgs = await withFullstack(args, { session })
    expect(fsArgs.session).toBeDefined()
    expect(typeof fsArgs.commitSession).toBe('function')
  })

  it('empty stack returns base args with commitSession', async () => {
    const args = makeArgs()
    const fsArgs = await withFullstack(args, {})
    expect(fsArgs.request).toBe(args.request)
    expect(typeof fsArgs.commitSession).toBe('function')
  })
})

// ── Cookie header helpers ──────────────────────────────────────────────────────

describe('authCookieHeader', () => {
  it('produces a valid Set-Cookie string', () => {
    const header = authCookieHeader('token-abc')
    expect(header).toContain('fs_token=')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=604800')
  })

  it('respects custom cookie name', () => {
    const header = authCookieHeader('token', { authCookie: 'auth_tok' })
    expect(header).toContain('auth_tok=')
  })

  it('respects custom maxAge', () => {
    const header = authCookieHeader('token', { maxAge: 3600 })
    expect(header).toContain('Max-Age=3600')
  })
})

describe('clearAuthCookieHeader', () => {
  it('sets Max-Age=0 to clear the cookie', () => {
    const header = clearAuthCookieHeader()
    expect(header).toContain('fs_token=')
    expect(header).toContain('Max-Age=0')
  })

  it('respects custom cookie name', () => {
    const header = clearAuthCookieHeader({ authCookie: 'auth_tok' })
    expect(header).toContain('auth_tok=')
    expect(header).toContain('Max-Age=0')
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

  it('generates a token without a session', async () => {
    const security = createSecurity()
    const token = await getCsrfToken({}, security)
    expect(typeof token).toBe('string')
  })
})

// ── validateBody ──────────────────────────────────────────────────────────────

describe('validateBody', () => {
  it('returns validated data for valid JSON body', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
    })

    const result = await validateBody(request, undefined, {
      name: 'required|string',
      email: 'required|email',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Bob')
  })

  it('returns errors for invalid data', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    const result = await validateBody(request, undefined, {
      name: 'required|string',
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
    const errors = next.getFlash('_errors')
    expect(errors).toBeDefined()
  })
})
