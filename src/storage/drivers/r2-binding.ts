import type { StorageDriver, FileMeta } from '../types.js'
import { StorageError } from '../../errors/http-errors.js'
import { toBytes } from '../bytes.js'
import { encodeKey } from '../sigv4.js'

/**
 * The slice of Cloudflare's `R2Bucket` binding the driver touches. Typed here so that
 * `@cloudflare/workers-types` stays the app's choice; the real binding satisfies it.
 */
export interface R2BindingBucket {
  head(key: string): Promise<object | null>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  put(
    key: string,
    value: Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: { key: string }[]
    truncated: boolean
    cursor?: string
  }>
}

export interface R2BindingDriverOptions {
  /** The bucket binding, `env.BUCKET` in a Worker or `platform.env.BUCKET` in SvelteKit */
  bucket: R2BindingBucket
  /** The bucket's public URL (custom domain or `r2.dev`); a binding has none, so `getUrl` throws without it */
  publicUrl?: string
}

/**
 * Cloudflare R2 over the bucket binding, inside a Worker: no keys, no signing, no `fetch`.
 * `put` reads a stream into memory first, since the binding wants a known length. `list` walks
 * every page. Multipart uploads and streaming `get` are not covered.
 */
export function createR2BindingDriver(options: R2BindingDriverOptions): StorageDriver {
  const { bucket } = options
  const publicUrl = options.publicUrl?.replace(/\/$/, '')

  return {
    async get(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
      const object = await bucket.get(key)
      if (object === null) return null
      return new Uint8Array(await object.arrayBuffer())
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, meta: FileMeta = {}): Promise<void> {
      const value = data instanceof ReadableStream ? await toBytes(data) : data
      await bucket.put(key, value, meta.contentType ? { httpMetadata: { contentType: meta.contentType } } : undefined)
    },

    async delete(key: string): Promise<void> {
      await bucket.delete(key)
    },

    async exists(key: string): Promise<boolean> {
      return (await bucket.head(key)) !== null
    },

    async list(prefix?: string): Promise<string[]> {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const page = await bucket.list({ prefix, cursor })
        for (const object of page.objects) keys.push(object.key)
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor !== undefined)
      return keys
    },

    async getUrl(key: string): Promise<string> {
      if (!publicUrl) {
        throw new StorageError(
          `R2 binding has no URL for "${key}": pass publicUrl (the bucket's custom domain or r2.dev URL) to createR2BindingDriver.`,
        )
      }
      return `${publicUrl}/${encodeKey(key)}`
    },
  }
}
