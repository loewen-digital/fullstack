/**
 * Opaque tokens: the random secret a session cookie or a one-time mail carries.
 *
 * The store never sees the raw value. `AuthDbAdapter` receives and looks up
 * `hashToken(raw)`, so a bucket listing, a backup or a log line of the auth
 * collections holds nothing that logs in or resets a password
 * (docs/decisions/0011).
 */

const TOKEN_BYTES = 32

/** A fresh random token: 32 bytes from Web Crypto as 64 hex characters. */
export function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/**
 * The value under which a session or one-time token is stored: SHA-256 of the
 * raw token as 64 hex characters. The raw token carries 256 random bits, so a
 * plain hash is enough; there is no salt or pepper to keep.
 */
export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
