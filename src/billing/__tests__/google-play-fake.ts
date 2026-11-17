/**
 * Google, as far as the Google Play driver talks to it, for a test run: the token service, the
 * Android Publisher API for purchases, the public keys Google signs with, and push requests as
 * Cloud Pub/Sub sends them. The keys are generated per run and never leave the process: no key
 * of anyone is near the tests.
 */

type Fields = Record<string, unknown>

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

export const FAKE_CLIENT_EMAIL = 'billing@example-project.iam.gserviceaccount.com'
export const FAKE_KEY_ID = 'test-key-1'

const encoder = new TextEncoder()
const base64 = (bytes: Uint8Array | ArrayBuffer): string =>
  btoa(String.fromCharCode(...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
const base64Url = (bytes: Uint8Array | ArrayBuffer): string =>
  base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

function generate(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  )
}

/** A JWT signed with RS256, as Google signs and as a service account does */
export async function signJwt(key: CryptoKey, header: Fields, claims: Fields): Promise<string> {
  const signed = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(encoder.encode(JSON.stringify(claims)))}`
  return `${signed}.${base64Url(await crypto.subtle.sign(RSA, key, encoder.encode(signed)))}`
}

// Generating an RSA key takes a moment: one set for all tests of a run.
let shared:
  | Promise<{ account: CryptoKeyPair; google: CryptoKeyPair; stranger: CryptoKeyPair }>
  | undefined

export interface PushOptions {
  /** Claims of the token that differ from what Cloud Pub/Sub would sign */
  claims?: Fields
  /** Header fields of the token that differ */
  header?: Fields
  /** Sign with a key Google does not publish */
  stranger?: boolean
  /** The header as it is, instead of a signed token; `null` for none */
  authorization?: string | null
  /** The notification as the body, as a subscription set to unwrap sends it */
  unwrapped?: boolean
  /** The body as it is, instead of a message around the notification */
  body?: string
  method?: string
}

export interface FakeGoogle {
  /** What the driver gets as `fetch` */
  fetch: typeof fetch
  /** `client_email` and `private_key` of the key file of the service account */
  clientEmail: string
  privateKey: string
  /** The purchases Google holds, by purchase token, in the shape of its API */
  subscriptions: Map<string, Fields>
  products: Map<string, Fields>
  /** Every request that reached Google, in order; `body` is what a call of the API carried */
  calls: { method: string; url: string; body?: string }[]
  /** The claims of every assertion the token service took */
  assertions: Fields[]
  /** Answers the next request whose URL contains `part` with this instead */
  failNext(part: string, status: number, body?: unknown): void
  /** A push request of Cloud Pub/Sub that carries a developer notification */
  push(notification: unknown, options?: PushOptions): Promise<Request>
}

export async function createFakeGoogle(
  options: { packageName: string; audience: string; pushServiceAccount?: string } = {
    packageName: 'com.example.app',
    audience: 'https://example.com/billing/webhook/play',
  },
): Promise<FakeGoogle> {
  shared ??= Promise.all([generate(), generate(), generate()]).then(
    ([account, google, stranger]) => ({ account, google, stranger }),
  )
  const keys = await shared
  const pkcs8 = base64(await crypto.subtle.exportKey('pkcs8', keys.account.privateKey))
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
  const jwk = await crypto.subtle.exportKey('jwk', keys.google.publicKey)

  const subscriptions = new Map<string, Fields>()
  const products = new Map<string, Fields>()
  const calls: FakeGoogle['calls'] = []
  const assertions: Fields[] = []
  const failures: { part: string; status: number; body: unknown }[] = []
  const tokens = new Set<string>()

  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  const error = (code: number, status: string, message: string): Response =>
    json(code, { error: { code, message, status } })

  async function tokenService(init: RequestInit | undefined): Promise<Response> {
    const form = new URLSearchParams(String(init?.body))
    const [head, claims, signature] = (form.get('assertion') ?? '').split('.')
    const valid =
      init?.method === 'POST' &&
      form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' &&
      head !== undefined &&
      claims !== undefined &&
      signature !== undefined &&
      (await crypto.subtle.verify(
        RSA,
        keys.account.publicKey,
        fromBase64Url(signature),
        encoder.encode(`${head}.${claims}`),
      ))
    if (!valid) {
      return json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
    }
    assertions.push({
      header: JSON.parse(new TextDecoder().decode(fromBase64Url(head))) as unknown,
      ...(JSON.parse(new TextDecoder().decode(fromBase64Url(claims))) as Fields),
    })
    const token = `ya29.fake-${assertions.length}`
    tokens.add(token)
    return json(200, { access_token: token, expires_in: 3600, token_type: 'Bearer' })
  }

  function api(method: string, path: string, init: RequestInit | undefined): Response {
    const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''
    if (!tokens.has(bearer)) {
      return error(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.')
    }
    const prefix = `${options.packageName}/purchases/`
    if (!path.startsWith(prefix)) return error(404, 'NOT_FOUND', 'No application was found.')
    const rest = path.slice(prefix.length)
    const missing = (): Response => error(404, 'NOT_FOUND', 'The purchase token was not found.')

    let match = /^subscriptionsv2\/tokens\/([^/:]+)$/.exec(rest)
    if (match && method === 'GET') {
      const found = subscriptions.get(decodeURIComponent(match[1]!))
      return found ? json(200, found) : missing()
    }
    match = /^productsv2\/tokens\/([^/:]+)$/.exec(rest)
    if (match && method === 'GET') {
      const found = products.get(decodeURIComponent(match[1]!))
      return found ? json(200, found) : missing()
    }
    match = /^subscriptions\/([^/]+)\/tokens\/([^/:]+):acknowledge$/.exec(rest)
    if (match && method === 'POST') {
      const token = decodeURIComponent(match[2]!)
      const found = subscriptions.get(token)
      const item = (found?.lineItems as Fields[] | undefined)?.[0]
      if (!found || item?.productId !== decodeURIComponent(match[1]!)) return missing()
      subscriptions.set(token, {
        ...found,
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      })
      return json(204, null)
    }
    match = /^products\/([^/]+)\/tokens\/([^/:]+):(acknowledge|consume)$/.exec(rest)
    if (match && method === 'POST') {
      const token = decodeURIComponent(match[2]!)
      const found = products.get(token)
      const item = (found?.productLineItem as Fields[] | undefined)?.[0]
      if (!found || !item || item.productId !== decodeURIComponent(match[1]!)) return missing()
      products.set(token, {
        ...found,
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        productLineItem: [
          match[3] === 'consume'
            ? {
                ...item,
                productOfferDetails: {
                  ...(item.productOfferDetails as Fields),
                  consumptionState: 'CONSUMPTION_STATE_CONSUMED',
                },
              }
            : item,
        ],
      })
      return json(204, null)
    }
    return error(404, 'NOT_FOUND', 'Not found.')
  }

  return {
    clientEmail: FAKE_CLIENT_EMAIL,
    privateKey,
    subscriptions,
    products,
    calls,
    assertions,

    failNext(part, status, body) {
      failures.push({ part, status, body })
    },

    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({
        method,
        url,
        ...(url.startsWith(API) && typeof init?.body === 'string' ? { body: init.body } : {}),
      })
      const failure = failures.findIndex((entry) => url.includes(entry.part))
      if (failure !== -1) {
        const [{ status, body }] = failures.splice(failure, 1) as [(typeof failures)[number]]
        return json(
          status,
          body ?? { error: { code: status, message: 'failed', status: 'FAILED' } },
        )
      }
      if (url === TOKEN_URL) return tokenService(init)
      if (url === CERTS_URL) {
        return json(
          200,
          { keys: [{ ...jwk, kid: FAKE_KEY_ID, alg: 'RS256', use: 'sig' }] },
          { 'Cache-Control': 'public, max-age=3600, must-revalidate, no-transform' },
        )
      }
      if (url.startsWith(API)) return api(method, url.slice(API.length), init)
      throw new TypeError(`the fake knows no ${url}`)
    }) as typeof fetch,

    async push(notification, push = {}) {
      const issuedAt = Math.floor(Date.now() / 1000)
      const authorization =
        push.authorization !== undefined
          ? push.authorization
          : `Bearer ${await signJwt(
              (push.stranger ? keys.stranger : keys.google).privateKey,
              { alg: 'RS256', kid: FAKE_KEY_ID, typ: 'JWT', ...push.header },
              {
                aud: options.audience,
                azp: '113774264463038321964',
                email: options.pushServiceAccount ?? FAKE_CLIENT_EMAIL,
                email_verified: true,
                exp: issuedAt + 3600,
                iat: issuedAt,
                iss: 'https://accounts.google.com',
                sub: '113774264463038321964',
                ...push.claims,
              },
            )}`
      const body =
        push.body ??
        JSON.stringify(
          push.unwrapped
            ? notification
            : {
                message: {
                  data: base64(encoder.encode(JSON.stringify(notification))),
                  messageId: '136969346945',
                  publishTime: new Date().toISOString(),
                },
                subscription: 'projects/example-project/subscriptions/play-billing',
              },
        )
      const method = push.method ?? 'POST'
      return new Request(options.audience, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        ...(method === 'GET' ? {} : { body }),
      })
    },
  }
}
