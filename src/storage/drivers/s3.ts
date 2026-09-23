import type { StorageDriver, FileMeta } from '../types.js'
import { StorageError } from '../../errors/http-errors.js'
import { toBytes } from '../bytes.js'
import { encodeKey, sha256Hex, signRequest, uriEncode } from '../sigv4.js'

export interface S3DriverOptions {
  bucket: string
  /** The bucket's region; `auto` on R2, `us-east-1` on most other S3-compatible services */
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** The service's URL, `https://s3.<region>.amazonaws.com` without */
  endpoint?: string
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key`; MinIO, R2 and most self-hosted services want it */
  forcePathStyle?: boolean
}

/**
 * S3 and every service that speaks its API, through `fetch` with AWS Signature V4 from Web Crypto.
 * No SDK. Every request is signed, so a private bucket works. `put` reads a stream into memory
 * first: S3 wants the length and the payload hash up front. Multipart uploads, presigned URLs
 * and continuation on `list` (the first 1000 keys) are not covered.
 */
export function createS3Driver(options: S3DriverOptions): StorageDriver {
  return createS3CompatibleDriver(options, 'S3')
}

/** @internal The S3 driver under the service's name in its errors; the R2 driver builds on it. */
export function createS3CompatibleDriver(options: S3DriverOptions, service: string): StorageDriver {
  const { bucket, region } = options
  const credentials = { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
  const endpoint = new URL(options.endpoint ?? `https://s3.${region}.amazonaws.com`)

  function bucketUrl(): URL {
    const url = new URL(endpoint)
    if (options.forcePathStyle) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${bucket}`
    } else {
      url.hostname = `${bucket}.${url.hostname}`
    }
    return url
  }

  function objectUrl(key: string): URL {
    const url = bucketUrl()
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeKey(key)}`
    return url
  }

  async function send(
    method: string,
    url: URL,
    body?: Uint8Array<ArrayBuffer>,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const request = new Request(url, { method, headers, body })
    const payloadHash = body === undefined ? undefined : await sha256Hex(body)
    return fetch(await signRequest(request, credentials, { region, payloadHash }))
  }

  function failed(operation: string, response: Response, key?: string): StorageError {
    const target = key === undefined ? '' : ` for "${key}"`
    return new StorageError(`${service} ${operation} failed${target}: ${response.status}`)
  }

  return {
    async get(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
      const response = await send('GET', objectUrl(key))
      if (response.status === 404) return null
      if (!response.ok) throw failed('GET', response, key)
      return new Uint8Array(await response.arrayBuffer())
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, meta: FileMeta = {}): Promise<void> {
      const headers: Record<string, string> = {}
      if (meta.contentType) headers['content-type'] = meta.contentType
      const response = await send('PUT', objectUrl(key), await toBytes(data), headers)
      if (!response.ok) throw failed('PUT', response, key)
    },

    async delete(key: string): Promise<void> {
      const response = await send('DELETE', objectUrl(key))
      if (!response.ok && response.status !== 404) throw failed('DELETE', response, key)
    },

    async exists(key: string): Promise<boolean> {
      const response = await send('HEAD', objectUrl(key))
      if (response.status === 404) return false
      if (!response.ok) throw failed('HEAD', response, key)
      return true
    },

    async list(prefix?: string): Promise<string[]> {
      const url = bucketUrl()
      url.search = prefix ? `list-type=2&prefix=${uriEncode(prefix)}` : 'list-type=2'
      const response = await send('GET', url)
      if (!response.ok) throw failed('LIST', response)
      return parseKeys(await response.text())
    },

    async getUrl(key: string): Promise<string> {
      return objectUrl(key).toString()
    },
  }
}

function parseKeys(xml: string): string[] {
  const keys: string[] = []
  for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
    keys.push(unescapeXml(match[1]!))
  }
  return keys
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (entity, name: string, dec?: string, hex?: string) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec))
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16))
    return XML_ENTITIES[name] ?? entity
  })
}
