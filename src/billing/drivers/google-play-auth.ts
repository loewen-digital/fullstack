/**
 * Who is who between the Google Play driver and Google: the access token of a service account,
 * which the driver calls Google's API with, and the check of the token Cloud Pub/Sub signs its
 * push requests with. Web Crypto and `fetch` only: no dependency.
 */
import { BillingError } from '../errors.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
/** Google writes its issuer with and without the scheme */
const ISSUERS: readonly unknown[] = ['https://accounts.google.com', 'accounts.google.com']
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
/** How far the clock of this server may be from Google's */
const MAX_SKEW = 60_000
const MAX_TOKEN_LENGTH = 4096
/** Google's keys are asked for again after this long at the earliest, whatever a request claims */
const KEYS_REFETCH_AFTER = 60_000

type Fields = Record<string, unknown>

/** A push request that does not carry the token Google signed for this subscription */
export class GoogleTokenError extends Error {
  override name = 'GoogleTokenError'
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  let binary = ''
  for (const byte of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decodes base64 and base64url; `null` for anything else */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (base64 === '' || !/^[A-Za-z0-9+/]+$/.test(base64) || base64.length % 4 === 1) return null
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The PKCS #8 bytes of `private_key` of a service account's key file; `null` when the text is
 * no such key. An environment variable often carries the line breaks as the two characters `\n`.
 */
export function privateKeyOf(pem: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof pem !== 'string' || !pem.includes('PRIVATE KEY')) return null
  return fromBase64(
    pem
      .replace(/\\n/g, '\n')
      .replace(/-----[A-Z ]+-----/g, '')
      .replace(/\s+/g, ''),
  )
}

/** The message of an error and of what caused it: `fetch` says only "fetch failed" itself */
export function messageOfError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause: unknown = error.cause
  return cause instanceof Error && cause.message !== ''
    ? `${error.message} (${cause.message})`
    : error.message
}

function fields(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function jsonOf(base64Url: string): Fields | undefined {
  const bytes = fromBase64(base64Url)
  if (!bytes) return undefined
  try {
    return fields(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return undefined
  }
}

export interface GoogleAccess {
  /** A token Google's API takes: asked for once and used until shortly before it ends */
  token(): Promise<string>
  /** Forgets the token, after Google refused it */
  reset(): void
}

interface GoogleAccessOptions {
  clientEmail: string
  /** The PKCS #8 bytes of the service account's key */
  privateKey: Uint8Array<ArrayBuffer>
  fetch: typeof fetch
  timeoutMs: number
}

/**
 * The access of a service account to the Android Publisher API: a JWT signed with the account's
 * key (RS256), exchanged for an access token at Google's token service.
 */
export function createGoogleAccess(options: GoogleAccessOptions): GoogleAccess {
  let signingKey: Promise<CryptoKey> | undefined
  let cached: { value: Promise<string>; refreshAt: number } | undefined

  async function request(): Promise<{ token: string; seconds: number }> {
    signingKey ??= crypto.subtle
      .importKey('pkcs8', options.privateKey, RSA, false, ['sign'])
      .catch(() => {
        signingKey = undefined
        throw new BillingError(
          "billing: `privateKey` of the Google Play driver is not an RSA key: it has to be `private_key` of the service account's key file.",
        )
      })
    const key = await signingKey
    const issuedAt = Math.floor(Date.now() / 1000)
    const signed = `${toBase64Url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${toBase64Url(
      encoder.encode(
        JSON.stringify({
          iss: options.clientEmail,
          scope: SCOPE,
          aud: TOKEN_URL,
          iat: issuedAt,
          exp: issuedAt + 3600,
        }),
      ),
    )}`
    const assertion = `${signed}.${toBase64Url(await crypto.subtle.sign(RSA, key, encoder.encode(signed)))}`

    let response: Response
    try {
      response = await options.fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch (error) {
      throw new BillingError(
        `billing: Google's token service was not reached: ${messageOfError(error)}`,
      )
    }
    const answer = fields(await response.json().catch(() => null))
    const token = text(answer?.access_token)
    if (!response.ok || !token) {
      // Google's error and its description are about the request, never about the key.
      const reason = [text(answer?.error), text(answer?.error_description)]
        .filter(Boolean)
        .join(': ')
        .slice(0, 300)
      throw new BillingError(
        `billing: Google gave the service account no access token (${response.status}${reason ? ` ${reason}` : ''}). Check \`clientEmail\` and \`privateKey\` of the Google Play driver.`,
      )
    }
    const seconds = answer?.expires_in
    return { token, seconds: typeof seconds === 'number' && seconds > 0 ? seconds : 3600 }
  }

  return {
    token() {
      if (cached && cached.refreshAt > Date.now()) return cached.value
      // One request for everyone who asks while it runs.
      const entry = { value: Promise.resolve(''), refreshAt: Number.POSITIVE_INFINITY }
      entry.value = request().then(({ token, seconds }) => {
        // Renewed five minutes before it ends, so no request carries a token that runs out on its way.
        entry.refreshAt = Date.now() + Math.max(seconds - 300, seconds / 2) * 1000
        return token
      })
      cached = entry
      // A failure is asked again next time instead of answered from the cache.
      entry.value.catch(() => {
        if (cached === entry) cached = undefined
      })
      return entry.value
    },
    reset() {
      cached = undefined
    },
  }
}

interface GooglePushCheckOptions {
  /** The audience set on the push subscription */
  audience: string
  /** The service account the push subscription signs as */
  serviceAccount: string
  fetch: typeof fetch
  timeoutMs: number
}

/**
 * The check of a push request of Cloud Pub/Sub: its `Authorization` header carries a JWT that
 * Google signed (RS256) for the service account and the audience of the push subscription.
 * Resolves for such a token and throws `GoogleTokenError` for everything else. Google's public
 * keys are fetched once and kept for as long as Google says they are good.
 */
export function createGooglePushCheck(
  options: GooglePushCheckOptions,
): (authorization: string | null) => Promise<void> {
  let keys: { byId: Map<string, CryptoKey>; fetchedAt: number; freshUntil: number } | undefined
  let loading: Promise<NonNullable<typeof keys>> | undefined

  async function load(): Promise<NonNullable<typeof keys>> {
    let response: Response
    try {
      response = await options.fetch(CERTS_URL, { signal: AbortSignal.timeout(options.timeoutMs) })
    } catch (error) {
      throw new BillingError(
        `billing: Google's signing keys were not reached: ${messageOfError(error)}`,
      )
    }
    const answer = fields(await response.json().catch(() => null))
    const byId = new Map<string, CryptoKey>()
    for (const entry of Array.isArray(answer?.keys) ? answer.keys : []) {
      const jwk = fields(entry)
      const id = text(jwk?.kid)
      const n = text(jwk?.n)
      const e = text(jwk?.e)
      if (!jwk || !id || !n || !e || jwk.kty !== 'RSA') continue
      if ((jwk.use ?? 'sig') !== 'sig' || (jwk.alg ?? 'RS256') !== 'RS256') continue
      try {
        byId.set(
          id,
          await crypto.subtle.importKey(
            'jwk',
            { kty: 'RSA', n, e, alg: 'RS256', ext: true },
            RSA,
            false,
            ['verify'],
          ),
        )
      } catch {
        // An entry that is no key is left out; a token it signed finds none.
      }
    }
    if (!response.ok || byId.size === 0) {
      throw new BillingError(
        `billing: Google's signing keys could not be read (${response.status}).`,
      )
    }
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')
    const seconds = Math.min(Math.max(maxAge ? Number(maxAge[1]) : 3600, 300), 86_400)
    const now = Date.now()
    return { byId, fetchedAt: now, freshUntil: now + seconds * 1000 }
  }

  async function keyOf(id: string): Promise<CryptoKey | undefined> {
    const now = Date.now()
    if (keys && keys.freshUntil > now) {
      const known = keys.byId.get(id)
      // A key the driver does not know: Google has new ones, or the id is made up. Google is
      // asked again, but not for every request that claims an id.
      if (known || now - keys.fetchedAt < KEYS_REFETCH_AFTER) return known
    }
    loading ??= load().finally(() => {
      loading = undefined
    })
    keys = await loading
    return keys.byId.get(id)
  }

  return async function check(authorization) {
    const refuse = (message: string): never => {
      throw new GoogleTokenError(message)
    }
    const header = authorization ?? ''
    const match =
      header.length <= MAX_TOKEN_LENGTH
        ? /^Bearer +([\w-]+)\.([\w-]+)\.([\w-]+)$/i.exec(header)
        : null
    if (!match) return refuse('the request carries no token of Google')
    const [, encodedHead, encodedClaims, encodedSignature] = match as unknown as [
      string,
      string,
      string,
      string,
    ]
    const head = jsonOf(encodedHead)
    const claims = jsonOf(encodedClaims)
    const signature = fromBase64(encodedSignature)
    const keyId = text(head?.kid)
    // The algorithm is fixed: a token that names another one is not read any further.
    if (!head || !claims || !signature || head.alg !== 'RS256' || !keyId) {
      return refuse('the token is not one Google signs')
    }
    if (!ISSUERS.includes(claims.iss)) return refuse('the token is not issued by Google')
    if (claims.aud !== options.audience) return refuse('the token is for another audience')
    if (claims.email !== options.serviceAccount || claims.email_verified !== true) {
      return refuse('the token is not signed for the service account of the push subscription')
    }
    const now = Date.now()
    const expires = typeof claims.exp === 'number' ? claims.exp * 1000 : Number.NaN
    if (!(expires + MAX_SKEW > now)) return refuse('the token has expired')
    if (typeof claims.iat === 'number' && claims.iat * 1000 - MAX_SKEW > now) {
      return refuse('the token is from the future')
    }

    const key = await keyOf(keyId)
    if (!key) return refuse('the token is signed with a key Google does not publish')
    const valid = await crypto.subtle.verify(
      RSA,
      key,
      signature,
      encoder.encode(`${encodedHead}.${encodedClaims}`),
    )
    if (!valid) return refuse('the signature of the token does not match')
  }
}
