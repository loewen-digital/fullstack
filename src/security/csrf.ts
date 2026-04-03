/**
 * CSRF token generation and verification using HMAC-SHA256.
 *
 * Token format: base64url(randomBytes) + '.' + base64url(hmac)
 * The HMAC covers: sessionId + '|' + nonce
 *
 * Uses only Web Crypto API (crypto.subtle) — works in Node, Deno, Bun, CF Workers.
 */

function encodeBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function decodeBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')
  const binary = atob(padded)
  return new Uint8Array(binary.split('').map((c) => c.charCodeAt(0)))
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(secret)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function computeHmac(key: CryptoKey, data: string): Promise<Uint8Array> {
  const dataBytes = new TextEncoder().encode(data)
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes)
  return new Uint8Array(sig)
}

/**
 * Generate a CSRF token tied to a session id.
 */
export async function generateCsrfToken(sessionId: string, secret: string): Promise<string> {
  const nonce = new Uint8Array(16)
  crypto.getRandomValues(nonce)
  const nonceStr = encodeBase64Url(nonce)

  const key = await importHmacKey(secret)
  const mac = await computeHmac(key, `${sessionId}|${nonceStr}`)

  return `${nonceStr}.${encodeBase64Url(mac)}`
}

/**
 * Verify a CSRF token for the given session id.
 * Returns true only when the HMAC matches.
 */
export async function verifyCsrfToken(
  sessionId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  try {
    const [nonceStr, macStr] = token.split('.')
    if (!nonceStr || !macStr) return false

    const key = await importHmacKey(secret)
    const expectedMac = await computeHmac(key, `${sessionId}|${nonceStr}`)
    const providedMac = decodeBase64Url(macStr)

    if (expectedMac.length !== providedMac.length) return false

    // Constant-time comparison
    let diff = 0
    for (let i = 0; i < expectedMac.length; i++) {
      diff |= expectedMac[i] ^ providedMac[i]
    }
    return diff === 0
  } catch {
    return false
  }
}
