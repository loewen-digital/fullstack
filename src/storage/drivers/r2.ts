import type { StorageDriver } from '../types.js'
import { createS3CompatibleDriver } from './s3.js'
import { encodeKey } from '../sigv4.js'

export interface R2DriverOptions {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** The bucket's public URL (custom domain or `r2.dev`); without it `getUrl` returns the S3 endpoint URL */
  publicUrl?: string
}

/**
 * Cloudflare R2 through its S3 API, for Node and everything outside a Worker: the S3 driver on
 * `https://<accountId>.r2.cloudflarestorage.com` with region `auto`, every request signed. Inside a
 * Worker, `createR2BindingDriver` takes the bucket binding and needs no keys.
 */
export function createR2Driver(options: R2DriverOptions): StorageDriver {
  const driver = createS3CompatibleDriver(
    {
      bucket: options.bucket,
      region: 'auto',
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
    },
    'R2',
  )
  const publicUrl = options.publicUrl?.replace(/\/$/, '')
  if (!publicUrl) return driver

  return {
    ...driver,
    async getUrl(key: string): Promise<string> {
      return `${publicUrl}/${encodeKey(key)}`
    },
  }
}
