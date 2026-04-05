---
title: Storage
description: File storage with local, S3, R2, and memory drivers
---

# Storage

The `storage` module provides a unified API for file storage. Store files locally during development and switch to S3 or R2 for production without touching your upload or retrieval logic.

## Import

```ts
import { createStorage } from '@loewen-digital/fullstack/storage'
```

## Basic usage

```ts
import { createStorage } from '@loewen-digital/fullstack/storage'

const storage = createStorage({
  driver: 'local',
  local: { root: './uploads' },
})

// Store a file
await storage.put('avatars/alice.png', imageBytes)

// Check existence
const exists = await storage.exists('avatars/alice.png') // true

// Retrieve a file as a stream
const stream = await storage.get('avatars/alice.png')

// Get a public URL
const url = await storage.getUrl('avatars/alice.png')

// Delete a file
await storage.delete('avatars/alice.png')

// List files by prefix
const files = await storage.list('avatars/')
```

## Handling file uploads

```ts
const formData = await request.formData()
const file = formData.get('avatar') as File

const key = `avatars/${crypto.randomUUID()}.${file.name.split('.').pop()}`
await storage.put(key, await file.arrayBuffer())

const url = await storage.getUrl(key)
```

## Production: S3 driver

```ts
const storage = createStorage({
  driver: 's3',
  s3: {
    bucket: process.env.S3_BUCKET!,
    region: process.env.AWS_REGION!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
```

## Production: Cloudflare R2

```ts
const storage = createStorage({
  driver: 'r2',
  r2: {
    bucket: process.env.R2_BUCKET!,
    accountId: process.env.CF_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    publicUrl: process.env.R2_PUBLIC_URL, // optional CDN URL
  },
})
```

## Driver options

| Driver | Description |
|---|---|
| `local` | Writes files to a local directory. Good for development. |
| `s3` | Amazon S3 or any S3-compatible service. Requires `@aws-sdk/client-s3`. |
| `r2` | Cloudflare R2 via S3-compatible API. Requires `@aws-sdk/client-s3`. |
| `memory` | In-process `Map`. Useful for tests. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'local' \| 's3' \| 'r2' \| 'memory'` | — | Storage driver |
| `local.root` | `string` | `'./storage'` | Root directory for local files |
| `local.baseUrl` | `string` | — | Base URL for `getUrl()` with local driver |
| `s3.bucket` | `string` | — | S3 bucket name |
| `s3.region` | `string` | — | AWS region |
| `s3.accessKeyId` | `string` | — | AWS access key ID |
| `s3.secretAccessKey` | `string` | — | AWS secret access key |
