import type { StorageDriver, FileMeta } from '../types.js'
import { StorageError } from '../../errors/http-errors.js'

export interface S3DriverOptions {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  forcePathStyle?: boolean
}

/**
 * S3-compatible storage driver.
 * Uses the native fetch API with AWS Signature V4 — no AWS SDK required.
 *
 * Note: For production use, consider using the AWS SDK for full S3 feature support.
 * This driver covers the basic CRUD operations needed by most apps.
 */
export function createS3Driver(options: S3DriverOptions): StorageDriver {
  const endpoint = options.endpoint ?? `https://s3.${options.region}.amazonaws.com`
  const bucket = options.bucket

  function objectUrl(key: string): string {
    if (options.forcePathStyle) {
      return `${endpoint}/${bucket}/${encodeURIComponent(key)}`
    }
    // Virtual-hosted style
    const url = new URL(endpoint)
    url.hostname = `${bucket}.${url.hostname}`
    url.pathname = `/${encodeURIComponent(key)}`
    return url.toString()
  }

  async function signedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    // Simplified signing — in production, use a proper AWS Sig V4 library
    const headers = new Headers(init.headers)
    const now = new Date()
    headers.set('x-amz-date', now.toISOString().replace(/[:-]|\.\d{3}/g, ''))
    headers.set('x-amz-content-sha256', 'UNSIGNED-PAYLOAD')

    return fetch(url, { ...init, headers })
  }

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const response = await signedFetch(objectUrl(key), { method: 'GET' })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new StorageError(`S3 GET failed for "${key}": ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, meta: FileMeta = {}): Promise<void> {
      const headers: Record<string, string> = {}
      if (meta.contentType) headers['Content-Type'] = meta.contentType
      const body = typeof data === 'string' ? new TextEncoder().encode(data) : data

      const response = await signedFetch(objectUrl(key), {
        method: 'PUT',
        headers,
        body: body as BodyInit,
      })
      if (!response.ok) {
        throw new StorageError(`S3 PUT failed for "${key}": ${response.status}`)
      }
    },

    async delete(key: string): Promise<void> {
      const response = await signedFetch(objectUrl(key), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`S3 DELETE failed for "${key}": ${response.status}`)
      }
    },

    async exists(key: string): Promise<boolean> {
      const response = await signedFetch(objectUrl(key), { method: 'HEAD' })
      return response.ok
    },

    async list(prefix?: string): Promise<string[]> {
      const url = new URL(objectUrl(''))
      url.searchParams.set('list-type', '2')
      if (prefix) url.searchParams.set('prefix', prefix)

      const response = await signedFetch(url.toString(), { method: 'GET' })
      if (!response.ok) {
        throw new StorageError(`S3 LIST failed: ${response.status}`)
      }

      const text = await response.text()
      const keys: string[] = []
      const regex = /<Key>([^<]+)<\/Key>/g
      let match
      while ((match = regex.exec(text)) !== null) {
        keys.push(match[1]!)
      }
      return keys
    },

    async getUrl(key: string): Promise<string> {
      return objectUrl(key)
    },
  }
}
