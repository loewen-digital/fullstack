/**
 * AWS Signature Version 4 through Web Crypto, for S3 and every service that speaks its API
 * (R2, MinIO, Backblaze B2, ...). No SDK, no `node:*`, so it runs on Node, Workers, Deno and Bun.
 */

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export interface SignRequestOptions {
  /** The bucket's region; `auto` on R2 */
  region: string
  /** The scope's service, `s3` unless the endpoint is another AWS API */
  service?: string
  /**
   * SHA-256 hex of the body, from `sha256Hex(bytes)`. Without it an empty body is signed as
   * empty and any other body as `UNSIGNED-PAYLOAD`, which S3 and R2 accept over HTTPS.
   */
  payloadHash?: string
  /** The signing time, now unless a test pins it */
  date?: Date
}

/** SHA-256 of nothing, the payload hash of a request without a body */
export const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

const encoder = new TextEncoder()

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

/**
 * URI-encode the way SigV4 canonicalizes: everything but `A-Z a-z 0-9 - _ . ~` as `%XX` with
 * upper-case hex, space as `%20`, `/` as `%2F`. `encodeURIComponent` leaves `!'()*` alone.
 */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** An object key as the path of its URL: every segment encoded once, `/` kept */
export function encodeKey(key: string): string {
  return key.split('/').map(uriEncode).join('/')
}

/**
 * Sign a request. Returns a copy with `x-amz-date`, `x-amz-content-sha256` and `Authorization`;
 * the given request is left as it is. Every header on the request is signed, so nothing may change
 * them on the way out; `host` comes from the URL. The path is signed the way S3 reads it, decoded
 * and then each segment encoded once, so an object URL built with `encodeKey` signs as intended.
 */
export async function signRequest(
  request: Request,
  credentials: SigV4Credentials,
  options: SignRequestOptions,
): Promise<Request> {
  const service = options.service ?? 's3'
  const date = options.date ?? new Date()
  const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${options.region}/${service}/aws4_request`
  const payloadHash = options.payloadHash ?? (request.body === null ? EMPTY_PAYLOAD_HASH : UNSIGNED_PAYLOAD)

  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.delete('authorization')
  headers.delete('host')
  headers.set('x-amz-date', amzDate)
  headers.set('x-amz-content-sha256', payloadHash)

  const canonicalHeaders: [string, string][] = [['host', url.host]]
  headers.forEach((value, name) => canonicalHeaders.push([name, value.trim().replace(/\s+/g, ' ')]))
  canonicalHeaders.sort(([a], [b]) => compare(a, b))
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(';')

  const canonicalRequest = [
    request.method,
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  let key: Uint8Array<ArrayBuffer> | ArrayBuffer = encoder.encode(`AWS4${credentials.secretAccessKey}`)
  for (const part of [dateStamp, options.region, service, 'aws4_request']) {
    key = await hmac(key, part)
  }
  const signature = hex(await hmac(key, stringToSign))

  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`,
  )
  return new Request(request, { headers })
}

function canonicalPath(pathname: string): string {
  return pathname.split('/').map((segment) => uriEncode(decodeSegment(segment))).join('/')
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function canonicalQuery(params: URLSearchParams): string {
  const pairs: [string, string][] = []
  params.forEach((value, name) => pairs.push([uriEncode(name), uriEncode(value)]))
  return pairs
    .sort(([aName, aValue], [bName, bValue]) => compare(aName, bName) || compare(aValue, bValue))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

async function hmac(key: Uint8Array<ArrayBuffer> | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
