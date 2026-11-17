/**
 * base64url and byte helpers of the push drivers. Web Crypto, `atob` and `btoa` only, so the
 * same code runs on Node, Cloudflare Workers, Deno and Bun.
 */

const encoder = new TextEncoder()

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  let binary = ''
  for (const byte of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decodes base64url, and plain base64 as some clients send it. `null` for anything else, so a
 * caller says what the value was meant to be instead of passing on `atob`'s error.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (base64 === '' || !/^[A-Za-z0-9+/]+$/.test(base64) || base64.length % 4 === 1) return null
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

/**
 * A JWT signed with ES256 (ECDSA on P-256 with SHA-256), as VAPID asks for. Web Crypto returns
 * the signature as `r || s`, which is the form a JWS carries.
 */
export async function signEs256Jwt(
  key: CryptoKey,
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): Promise<string> {
  const signed = `${toBase64Url(utf8(JSON.stringify(header)))}.${toBase64Url(utf8(JSON.stringify(claims)))}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signed))
  return `${signed}.${toBase64Url(signature)}`
}
