import { describe, it, expect, vi } from 'vitest'
import { createSecurity, corsHeaders, createRateLimiter, sanitize, escapeHtml } from '../index.js'

describe('createSecurity', () => {
  it('creates a security instance', () => {
    const security = createSecurity({ csrf: { secret: 'test-secret' } })
    expect(security).toBeDefined()
    expect(typeof security.generateCsrfToken).toBe('function')
    expect(typeof security.verifyCsrfToken).toBe('function')
  })
})

describe('CSRF', () => {
  const security = createSecurity({ csrf: { secret: 'test-secret-key' } })

  it('generates a token', async () => {
    const token = await security.generateCsrfToken('session-123')
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('verifies a valid token', async () => {
    const token = await security.generateCsrfToken('session-abc')
    const valid = await security.verifyCsrfToken('session-abc', token)
    expect(valid).toBe(true)
  })

  it('rejects a token for a different session', async () => {
    const token = await security.generateCsrfToken('session-abc')
    const valid = await security.verifyCsrfToken('session-xyz', token)
    expect(valid).toBe(false)
  })

  it('rejects a tampered token', async () => {
    const token = await security.generateCsrfToken('session-abc')
    const tampered = token.slice(0, -4) + 'XXXX'
    const valid = await security.verifyCsrfToken('session-abc', tampered)
    expect(valid).toBe(false)
  })

  it('rejects a malformed token', async () => {
    const valid = await security.verifyCsrfToken('session-abc', 'not-a-token')
    expect(valid).toBe(false)
  })
})

describe('CORS', () => {
  it('allows all origins with wildcard', () => {
    const headers = corsHeaders('https://example.com', { origins: '*' })
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('allows listed origins', () => {
    const headers = corsHeaders('https://example.com', {
      origins: ['https://example.com', 'https://other.com'],
    })
    expect(headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    expect(headers.get('Vary')).toBe('Origin')
  })

  it('blocks unlisted origins', () => {
    const headers = corsHeaders('https://evil.com', {
      origins: ['https://example.com'],
    })
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('sets credentials header when configured', () => {
    const headers = corsHeaders('https://example.com', {
      origins: '*',
      credentials: true,
    })
    expect(headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('handles null origin', () => {
    const headers = corsHeaders(null, { origins: '*' })
    expect(headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('Rate limiter', () => {
  it('allows requests within the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 })
    const result = limiter.check('user:1')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })
    limiter.check('user:2')
    limiter.check('user:2')
    limiter.check('user:2')
    const result = limiter.check('user:2')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('resets a key', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
    limiter.check('user:3')
    limiter.check('user:3')
    limiter.check('user:3') // over limit
    limiter.reset('user:3')
    const result = limiter.check('user:3')
    expect(result.allowed).toBe(true)
  })

  it('tracks different keys independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    limiter.check('user:a')
    limiter.check('user:a') // blocked
    const result = limiter.check('user:b')
    expect(result.allowed).toBe(true)
  })

  it('resets after the window expires', async () => {
    vi.useFakeTimers()
    const limiter = createRateLimiter({ windowMs: 100, max: 1 })
    limiter.check('user:4')
    const blocked = limiter.check('user:4')
    expect(blocked.allowed).toBe(false)

    vi.advanceTimersByTime(200)
    const allowed = limiter.check('user:4')
    expect(allowed.allowed).toBe(true)
    vi.useRealTimers()
  })
})

describe('sanitize', () => {
  it('removes script tags', () => {
    const result = sanitize('<script>alert("xss")</script>Hello')
    expect(result).toBe('Hello')
  })

  it('removes event handler attributes', () => {
    const result = sanitize('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })

  it('removes javascript: in href', () => {
    const result = sanitize('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain('javascript:')
  })

  it('strips all HTML tags', () => {
    const result = sanitize('<p>Hello <b>world</b></p>')
    expect(result).toBe('Hello world')
  })

  it('passes plain text unchanged', () => {
    const result = sanitize('Hello, world!')
    expect(result).toBe('Hello, world!')
  })
})

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
    expect(escapeHtml("it's")).toBe('it&#39;s')
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })
})
