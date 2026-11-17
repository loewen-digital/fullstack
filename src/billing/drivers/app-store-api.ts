/**
 * The one question the App Store driver asks Apple: what a transaction is today, through Get
 * Transaction Info of the App Store Server API. A request is signed as an In-App Purchase key of
 * App Store Connect (a JWT, ES256). Web Crypto and `fetch` only: no dependency.
 */
import { BillingError } from '../errors.js'
import type { AppStoreApiKey, AppStoreEnvironment } from '../types.js'
import { fromBase64 } from './app-store-jws.js'

const HOSTS: Record<AppStoreEnvironment, string> = {
  production: 'https://api.storekit.apple.com',
  sandbox: 'https://api.storekit-sandbox.apple.com',
}
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
/** How long a token is good for. Apple takes up to an hour, and wants a token per request */
const TOKEN_SECONDS = 300
/** Apple's codes for a transaction it does not know, and for an id that is none */
const UNKNOWN: ReadonlySet<unknown> = new Set([4040010, 4000006])

type Fields = Record<string, unknown>

export interface AppStoreApi {
  /** The transaction as Apple signs it now, a JWS; `null` when Apple knows none under the id */
  transaction(id: string): Promise<string | null>
}

interface AppStoreApiOptions {
  key: AppStoreApiKey
  bundleId: string
  environment: AppStoreEnvironment
  fetch: typeof fetch
  timeoutMs: number
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  let binary = ''
  for (const byte of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The message of an error and of what caused it: `fetch` says only "fetch failed" itself */
function messageOfError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause: unknown = error.cause
  return cause instanceof Error && cause.message !== ''
    ? `${error.message} (${cause.message})`
    : error.message
}

/**
 * Apple's App Store Server API for one app in one environment. Throws `BillingError` for a key
 * that cannot be one; whether Apple takes the key shows with the first request.
 */
export function createAppStoreApi(options: AppStoreApiOptions): AppStoreApi {
  const key: Partial<AppStoreApiKey> | null =
    typeof options.key === 'object' && options.key !== null ? options.key : null
  const issuerId = key?.issuerId
  const keyId = key?.keyId
  if (typeof issuerId !== 'string' || !/^[\w-]{1,64}$/.test(issuerId)) {
    throw new BillingError(
      'billing: `apiKey.issuerId` of the App Store driver has to be the issuer id App Store Connect shows above the In-App Purchase keys.',
    )
  }
  if (typeof keyId !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(keyId)) {
    throw new BillingError(
      'billing: `apiKey.keyId` of the App Store driver has to be the id of an In-App Purchase key, as App Store Connect shows it.',
    )
  }
  const pem = key?.privateKey
  // An environment variable often carries the line breaks of the file as the two characters `\n`.
  const pkcs8 =
    typeof pem === 'string'
      ? fromBase64(
          pem
            .replace(/\\n/g, '\n')
            .replace(/-----[A-Z ]+-----/g, '')
            .replace(/\s+/g, ''),
        )
      : null
  if (!pkcs8) {
    throw new BillingError(
      'billing: `apiKey.privateKey` of the App Store driver has to be the contents of the .p8 file of the key.',
    )
  }
  const host = HOSTS[options.environment]
  let signingKey: Promise<CryptoKey> | undefined

  /** A token for one request, as Apple asks for it */
  async function bearer(): Promise<string> {
    signingKey ??= crypto.subtle.importKey('pkcs8', pkcs8!, ECDSA, false, ['sign']).catch(() => {
      throw new BillingError(
        'billing: `apiKey.privateKey` of the App Store driver is not a signing key: it has to be the contents of the .p8 file of the key.',
      )
    })
    const issuedAt = Math.floor(Date.now() / 1000)
    const signed = `${toBase64Url(encoder.encode(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })))}.${toBase64Url(
      encoder.encode(
        JSON.stringify({
          iss: issuerId,
          iat: issuedAt,
          exp: issuedAt + TOKEN_SECONDS,
          aud: 'appstoreconnect-v1',
          bid: options.bundleId,
        }),
      ),
    )}`
    // Web Crypto signs ECDSA as `r || s`, which is what a JWS carries.
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await signingKey,
      encoder.encode(signed),
    )
    return `${signed}.${toBase64Url(signature)}`
  }

  return {
    async transaction(id) {
      const token = await bearer()
      let response: Response
      try {
        response = await options.fetch(`${host}/inApps/v1/transactions/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(options.timeoutMs),
        })
      } catch (error) {
        throw new BillingError(
          `billing: Apple's App Store Server API was not reached: ${messageOfError(error)}`,
        )
      }
      const body: unknown = await response.json().catch(() => null)
      const answer: Fields | undefined =
        typeof body === 'object' && body !== null ? (body as Fields) : undefined
      if (response.ok) {
        const jws = answer?.signedTransactionInfo
        if (typeof jws !== 'string' || jws === '') {
          throw new BillingError(
            'billing: Apple answered without the transaction that was asked for.',
          )
        }
        return jws
      }
      if (UNKNOWN.has(answer?.errorCode)) return null
      if (response.status === 401) {
        throw new BillingError(
          'billing: Apple did not take the key of the App Store driver (401). Check `apiKey`: the issuer id, the key id and the .p8 file of an In-App Purchase key, of the team that owns the app of `bundleId`.',
        )
      }
      // Apple's code and message are about the request, never about the key.
      const code = answer?.errorCode
      const message = answer?.errorMessage
      const reason = [
        typeof code === 'number' ? String(code) : '',
        typeof message === 'string' ? message.slice(0, 200) : '',
      ]
        .filter(Boolean)
        .join(': ')
      throw new BillingError(
        `billing: Apple's App Store Server API answered ${response.status}${reason ? ` (${reason})` : ''}.`,
      )
    },
  }
}
