/**
 * Apple's App Store Server API, as far as the App Store driver asks it, for a test run: Get
 * Transaction Info. It checks the token of a request as Apple's reference says a token has to be
 * (https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests,
 * read 2026-11-17) and answers what the test says Apple holds, signed with the chain of the run.
 * The key is generated per run and never leaves the process: no key of anyone is near the tests.
 */
import type { TestChain } from './app-store-chain.js'

type Fields = Record<string, unknown>

const HOSTS = {
  production: 'https://api.storekit.apple.com',
  sandbox: 'https://api.storekit-sandbox.apple.com',
} as const
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const

export const FAKE_ISSUER_ID = '4f1d2c3b-0a9e-4b8c-9d7e-6f5a4b3c2d1e'
export const FAKE_KEY_ID = 'TESTKEY123'

const base64 = (bytes: Uint8Array | ArrayBuffer): string =>
  btoa(String.fromCharCode(...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
const decoded = (part: string): Fields =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as Fields

export interface FakeAppStoreApi {
  /** What the driver gets as `apiKey` */
  apiKey: { issuerId: string; keyId: string; privateKey: string }
  /** What the driver gets as `fetch` */
  fetch: typeof fetch
  /** The transactions Apple holds, by id, as decoded payloads */
  transactions: Map<string, Fields>
  /** Every request that reached Apple with a token Apple takes, in order */
  calls: { url: string; token: string; header: Fields; claims: Fields }[]
  /** Answers the next request with this status instead; an `Error` fails the request itself */
  failNext(failure: number | Error, body?: unknown): void
  /** Answers the next request with this as the body of a 200 */
  answerNext(body: unknown): void
}

export async function createFakeAppStoreApi(options: {
  chain: TestChain
  bundleId: string
  environment?: keyof typeof HOSTS
}): Promise<FakeAppStoreApi> {
  const keys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const pkcs8 = base64(await crypto.subtle.exportKey('pkcs8', keys.privateKey))
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
  const prefix = `${HOSTS[options.environment ?? 'sandbox']}/inApps/v1/transactions/`

  const transactions = new Map<string, Fields>()
  const calls: FakeAppStoreApi['calls'] = []
  let next: { failure?: number | Error; body?: unknown } | undefined

  const json = (status: number, body: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  /** The header and the claims of a token Apple takes; `null` for every other one */
  async function taken(token: string): Promise<{ header: Fields; claims: Fields } | null> {
    const [head, body, signature, ...rest] = token.split('.')
    if (!head || !body || !signature || rest.length > 0) return null
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.publicKey,
      fromBase64Url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    )
    const header = decoded(head)
    const claims = decoded(body)
    const now = Date.now() / 1000
    const { iat, exp } = claims
    return valid &&
      header.alg === 'ES256' &&
      header.kid === FAKE_KEY_ID &&
      header.typ === 'JWT' &&
      claims.iss === FAKE_ISSUER_ID &&
      claims.aud === 'appstoreconnect-v1' &&
      claims.bid === options.bundleId &&
      typeof iat === 'number' &&
      typeof exp === 'number' &&
      exp > now &&
      // A token that runs for more than an hour is not valid.
      exp - iat <= 3600
      ? { header, claims }
      : null
  }

  return {
    apiKey: { issuerId: FAKE_ISSUER_ID, keyId: FAKE_KEY_ID, privateKey },
    transactions,
    calls,

    failNext(failure, body) {
      next = { failure, body }
    },

    answerNext(body) {
      next = { body }
    },

    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''
      const read = (init?.method ?? 'GET') === 'GET' ? await taken(token) : null
      // Apple answers a token it does not take without a body.
      if (!read) return json(401, undefined)
      calls.push({ url, token, ...read })

      const planned = next
      next = undefined
      if (planned?.failure instanceof Error) throw planned.failure
      if (planned) return json(planned.failure ?? 200, planned.body)

      const found = url.startsWith(prefix)
        ? transactions.get(decodeURIComponent(url.slice(prefix.length)))
        : undefined
      // A transaction of the other environment is one this one does not know.
      if (!found)
        return json(404, { errorCode: 4040010, errorMessage: 'Transaction id not found.' })
      return json(200, {
        signedTransactionInfo: await options.chain.sign({ ...found, signedDate: Date.now() }),
      })
    }) as typeof fetch,
  }
}
