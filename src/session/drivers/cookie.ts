import type { SessionDriver, SessionData, SessionPayload } from '../types.js'

/**
 * Cookie session driver: stateless, the whole session travels in the cookie.
 *
 * `serialize(id, data)` encodes `{ id, data, exp }` as base64url JSON and appends an
 * HMAC-SHA256 signature over it: `<payload>.<signature>`. `parse(value)` checks the
 * signature and the expiry and returns the payload, or `null`.
 *
 * The signature prevents tampering but does NOT encrypt: anyone holding the cookie can
 * read its JSON. Keep secrets (tokens, password hashes) out of the session.
 *
 * There is no store, so `read`, `write` and `destroy` do nothing. Go through
 * `SessionManager.open(cookie)` and `commit(handle)`, as the framework adapters do.
 */

export type CookieSessionDriver = SessionDriver & Required<Pick<SessionDriver, 'serialize' | 'parse'>>

interface Envelope extends SessionPayload {
  /** Expiry as unix seconds */
  exp: number
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function decodeBase64Url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
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

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.exp === 'number' &&
    typeof v.data === 'object' &&
    v.data !== null &&
    !Array.isArray(v.data)
  )
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * @param secret  signs the cookie; keep it out of the repository
 * @param ttlSeconds  a payload older than this is rejected by `parse` (default 2h)
 */
export function createCookieDriver(secret: string, ttlSeconds = 7200): CookieSessionDriver {
  return {
    generateId(): string {
      return crypto.randomUUID()
    },

    async read(): Promise<SessionData> {
      return {}
    },

    async write(): Promise<void> {},

    async destroy(): Promise<void> {},

    async serialize(sessionId: string, data: SessionData): Promise<string> {
      const envelope: Envelope = { id: sessionId, data, exp: nowSeconds() + ttlSeconds }
      const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(envelope)))
      const sig = await sign(payload, secret)
      return `${payload}.${sig}`
    },

    async parse(value: string): Promise<SessionPayload | null> {
      try {
        const dot = value.lastIndexOf('.')
        if (dot === -1) return null
        const payload = value.slice(0, dot)
        if (!(await verify(payload, value.slice(dot + 1), secret))) return null
        const parsed: unknown = JSON.parse(decodeBase64Url(payload))
        if (!isEnvelope(parsed) || parsed.exp <= nowSeconds()) return null
        return { id: parsed.id, data: parsed.data }
      } catch {
        return null
      }
    },
  }
}
