/**
 * Passwordless login: a short numeric code by mail, typed into the browser that asked for it.
 *
 * A code is not an opaque token. Six digits are a million values, so its plain hash in the store
 * would be the code to anyone who can read the store: the stored value is an HMAC under a secret
 * the store does not hold. And a code can be guessed, so it is looked up by user, never by its
 * hash, and every verification counts against a limit (docs/decisions/0018).
 */

import type { AuthDbAdapter, AuthUser } from './types.js'
import { toHex } from './opaque-token.js'

export const LOGIN_CODE_TYPE = 'login_code'

export interface LoginCodeOptions {
  secret: string | undefined
  ttlSeconds: number
  length: number
  maxAttempts: number
}

/**
 * Mint a login code for the user, store its HMAC and hand the code to `sendFn`.
 * The user's earlier login code is deleted first: only the most recently sent code works.
 */
export async function sendLoginCode(
  db: AuthDbAdapter,
  user: AuthUser,
  sendFn: (email: string, code: string) => Promise<void>,
  options: LoginCodeOptions,
): Promise<void> {
  const secret = requireSecret(options.secret)
  await db.deleteTokens(user.id, LOGIN_CODE_TYPE)

  const code = randomCode(options.length)
  const now = new Date()

  await db.createToken({
    userId: user.id,
    token: await hashLoginCode(secret, user.id, code),
    type: LOGIN_CODE_TYPE,
    expiresAt: new Date(now.getTime() + options.ttlSeconds * 1000),
    createdAt: now,
    attempts: 0,
  })

  await sendFn(user.email, code)
}

/**
 * Verify the user's login code. Returns the user id once for the right code within its TTL,
 * null otherwise. The code is deleted when it verifies, when it is found expired and with the
 * last allowed attempt, so after `maxAttempts` wrong codes the right one fails as well.
 *
 * The attempt is counted before the code is compared: guesses that arrive together each take
 * their count first, as far as the store counts atomically.
 */
export async function verifyLoginCode(
  db: AuthDbAdapter,
  user: AuthUser,
  code: string,
  options: LoginCodeOptions,
): Promise<string | number | null> {
  const secret = requireSecret(options.secret)

  const record = await db.findUserToken(user.id, LOGIN_CODE_TYPE)
  if (!record) return null
  if (record.expiresAt < new Date()) {
    await db.deleteToken(record.id)
    return null
  }

  const attempts = await db.countTokenAttempt(record.id)
  if (attempts === null) return null

  const candidate = code.trim()
  const matches =
    /^\d+$/.test(candidate) &&
    candidate.length === options.length &&
    timingSafeEqual(await hashLoginCode(secret, user.id, candidate), record.token)

  if (matches && attempts <= options.maxAttempts) {
    await db.deleteToken(record.id)
    return user.id
  }
  if (attempts >= options.maxAttempts) await db.deleteToken(record.id)
  return null
}

/** The value a login code is stored under: HMAC-SHA-256 over user id and code, as hex. */
export async function hashLoginCode(
  secret: string,
  userId: string | number,
  code: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${userId}:${code}`))
  return toHex(new Uint8Array(mac))
}

function requireSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error('Login codes need a secret: createAuth({ loginCodeSecret }, { db }).')
  }
  return secret
}

/** `length` decimal digits from Web Crypto, each uniform, leading zeros included. */
function randomCode(length: number): string {
  let code = ''
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // 250 is the largest multiple of ten a byte reaches: above it the digits would not be uniform.
      if (byte < 250 && code.length < length) code += String(byte % 10)
    }
  }
  return code
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
