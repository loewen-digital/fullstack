import type { StorageDriver, FileMeta } from '../types.js'
import { StorageError } from '../../errors/http-errors.js'

export interface R2DriverOptions {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicUrl?: string
}

/**
 * Cloudflare R2 storage driver.
 *
 * R2 is S3-compatible, so this driver uses the S3 API endpoint for R2.
 * For Workers runtime, use the R2 bindings directly.
 */
export function createR2Driver(options: R2DriverOptions): StorageDriver {
  const endpoint = `https://${options.accountId}.r2.cloudflarestorage.com`
  const bucket = options.bucket

  function objectUrl(key: string): string {
    return `${endpoint}/${bucket}/${encodeURIComponent(key)}`
  }

  return {
    async get(key: string): Promise<Uint8Array | null> {
      const response = await fetch(objectUrl(key), { method: 'GET' })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new StorageError(`R2 GET failed for "${key}": ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, meta: FileMeta = {}): Promise<void> {
      const headers: Record<string, string> = {}
      if (meta.contentType) headers['Content-Type'] = meta.contentType
      const body = typeof data === 'string' ? new TextEncoder().encode(data) : data

      const response = await fetch(objectUrl(key), {
        method: 'PUT',
        headers,
        body: body as BodyInit,
      })
      if (!response.ok) {
        throw new StorageError(`R2 PUT failed for "${key}": ${response.status}`)
      }
    },

    async delete(key: string): Promise<void> {
      const response = await fetch(objectUrl(key), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`R2 DELETE failed for "${key}": ${response.status}`)
      }
    },

    async exists(key: string): Promise<boolean> {
      const response = await fetch(objectUrl(key), { method: 'HEAD' })
      return response.ok
    },

    async list(prefix?: string): Promise<string[]> {
      const url = new URL(`${endpoint}/${bucket}`)
      url.searchParams.set('list-type', '2')
      if (prefix) url.searchParams.set('prefix', prefix)

      const response = await fetch(url.toString(), { method: 'GET' })
      if (!response.ok) {
        throw new StorageError(`R2 LIST failed: ${response.status}`)
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
      if (options.publicUrl) {
        return `${options.publicUrl}/${key}`
      }
      return objectUrl(key)
    },
  }
}
