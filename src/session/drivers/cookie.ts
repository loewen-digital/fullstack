import type { SessionDriver, SessionData } from '../types.js'

/**
 * Cookie session driver.
 *
 * Stores the entire session payload as a signed JSON cookie.
 * The signature prevents tampering but does NOT encrypt the data —
 * do not store sensitive values (passwords, tokens) in the session.
 *
 * This driver is stateless (no server-side storage). It works by:
 *  1. Encoding the session data as JSON → base64url
 *  2. Computing HMAC-SHA256 over the payload with the secret
 *  3. Joining them as: <payload>.<signature>
 *
 * The `read()` and `write()` methods operate on the in-memory data object.
 * The calling code is responsible for serializing/deserializing the cookie
 * header (e.g. via the framework adapter).
 */

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function decodeBase64Url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  return atob(padded)
}

async function sign(payload: string, secret: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(secret)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return encodeBase64Url(new Uint8Array(sig))
}

async function verify(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await sign(payload, secret)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

export function createCookieDriver(secret: string, _defaultTtl = 7200): SessionDriver & {
  /** Serialize the data object into a signed cookie value */
  serialize(data: SessionData): Promise<string>
  /** Parse and verify a cookie value, returning the data or {} on failure */
  parse(cookieValue: string): Promise<SessionData>
} {
  // In-memory store maps session ids to data (the "session" is just the id = cookie value)
  const sessions = new Map<string, SessionData>()

  async function serialize(data: SessionData): Promise<string> {
    const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(data)))
    const sig = await sign(payload, secret)
    return `${payload}.${sig}`
  }

  async function parse(cookieValue: string): Promise<SessionData> {
    try {
      const dot = cookieValue.lastIndexOf('.')
      if (dot === -1) return {}
      const payload = cookieValue.slice(0, dot)
      const sig = cookieValue.slice(dot + 1)
      if (!(await verify(payload, sig, secret))) return {}
      return JSON.parse(decodeBase64Url(payload)) as SessionData
    } catch {
      return {}
    }
  }

  const driver: SessionDriver & { serialize: typeof serialize; parse: typeof parse } = {
    generateId(): string {
      return crypto.randomUUID()
    },

    async read(sessionId: string): Promise<SessionData> {
      return sessions.get(sessionId) ?? {}
    },

    async write(sessionId: string, data: SessionData): Promise<void> {
      sessions.set(sessionId, { ...data })
    },

    async destroy(sessionId: string): Promise<void> {
      sessions.delete(sessionId)
    },

    serialize,
    parse,
  }

  return driver
}

export default createCookieDriver
