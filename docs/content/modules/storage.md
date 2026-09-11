---
title: Storage
description: One file API on memory, the local filesystem, S3 or Cloudflare R2
---

# Storage

`createStorage` stores files by key. The memory driver is built in; local filesystem, S3 and R2 drivers are built with their factories and handed to `createStorageInstance`. The instance reads bytes or text, writes bytes, strings or streams, lists by prefix and hands out URLs.

## Import

```ts
import { createStorage } from '@loewen-digital/fullstack/storage'
```

## Basic usage

```ts
import { createStorageInstance, createLocalDriver } from '@loewen-digital/fullstack/storage'

const storage = createStorageInstance(createLocalDriver({ root: './uploads', baseUrl: '/uploads' }))

async function roundTrip(bytes: Uint8Array) {
  await storage.put('avatars/alice.png', bytes, { contentType: 'image/png' })
  const exists = await storage.exists('avatars/alice.png') // true
  const data = await storage.get('avatars/alice.png') // Uint8Array | null
  const url = await storage.getUrl('avatars/alice.png') // '/uploads/avatars/alice.png'
  const keys = await storage.list('avatars/') // ['avatars/alice.png']
  await storage.delete('avatars/alice.png') // no error when missing
  return { exists, data, url, keys }
}
```

`put` takes a `Uint8Array`, a string (stored as UTF-8) or a `ReadableStream`. `getText` decodes a file as UTF-8. Keys are paths with `/`; the local driver strips `..`.

## Uploads

A `File` from `FormData` streams straight into `put`.

```ts
async function upload(request: Request) {
  const form = await request.formData()
  const file = form.get('avatar')
  if (!(file instanceof File)) return null

  const key = `avatars/${crypto.randomUUID()}.${file.name.split('.').pop()}`
  await storage.put(key, file.stream(), { contentType: file.type, contentLength: file.size })
  return storage.getUrl(key)
}
```

## Drivers

```ts
import { createStorage, createStorageInstance, createS3Driver, createR2Driver } from '@loewen-digital/fullstack/storage'

const inMemory = createStorage({ driver: 'memory' }) // tests

const onS3 = createStorageInstance(
  createS3Driver({
    bucket: process.env.S3_BUCKET!,
    region: process.env.AWS_REGION!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }),
)

const onR2 = createStorageInstance(
  createR2Driver({
    accountId: process.env.CF_ACCOUNT_ID!,
    bucket: process.env.R2_BUCKET!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    publicUrl: process.env.R2_PUBLIC_URL, // getUrl() returns publicUrl/key when set
  }),
)
```

| Driver | Options | `getUrl(key)` returns |
|---|---|---|
| `memory` (`createStorage({ driver: 'memory' })`) | none | a placeholder; data lives in a `Map` |
| `createLocalDriver({ root, baseUrl? })` | files under `root` | `baseUrl/key`, `baseUrl` default `/storage`; serving that path is yours |
| `createS3Driver({ bucket, region, accessKeyId, secretAccessKey, endpoint?, forcePathStyle? })` | S3 or any S3-compatible service, signed requests through `fetch` | the object URL on the endpoint (public only if the bucket is) |
| `createR2Driver({ accountId, bucket, accessKeyId, secretAccessKey, publicUrl? })` | R2 through its S3 endpoint | `publicUrl/key`, or the endpoint URL without `publicUrl` |

On Cloudflare Workers with an R2 binding, a custom driver over the binding avoids the S3 credentials: implement `StorageDriver` (`get`, `put`, `delete`, `exists`, `list`, `getUrl`) and pass it to `createStorageInstance`.

## Config options

`createStorage(config)` reads one option.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory'` | — | Naming `local`, `s3` or `r2` here throws and points to the driver factory |

`FileMeta` on `put` carries `contentType`, `contentLength` and `lastModified`; the S3 and R2 drivers send `contentType`, the local and memory drivers keep the bytes only.
