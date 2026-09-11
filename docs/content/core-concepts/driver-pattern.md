---
title: Driver Pattern
description: Modules with I/O take a driver; the driver decides where data goes, the module's API stays the same
---

# Driver Pattern

Every module with I/O (mail, storage, cache, session, queue, search, db, logging) does its work through a driver. The module's methods stay the same whichever driver is behind them; swapping the backend changes one line where the module is built.

## What a driver is

A driver is an object that implements the module's driver interface. For storage that is `StorageDriver`:

```ts
import type { FileMeta } from '@loewen-digital/fullstack/storage'

interface StorageDriver {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, data: Uint8Array | string | ReadableStream, meta?: FileMeta): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
  getUrl(key: string): Promise<string>
}
```

The instance the module returns (`StorageInstance`) adds what is driver-independent, such as `getText`, and forwards the rest.

## Choosing a driver

Two kinds of driver, two ways to get an instance:

- **Named drivers** need nothing but their name. `createX({ driver: 'memory' })` builds them.
- **Drivers with options** (credentials, a client, a path) are built with their own factory and handed to `createXInstance(driver)`. Naming one in `createX` throws and points to that factory.

```ts
import {
  createStorage,
  createStorageInstance,
  createLocalDriver,
  createS3Driver,
  createR2Driver,
} from '@loewen-digital/fullstack/storage'

const inMemory = createStorage({ driver: 'memory' }) // tests
const onDisk = createStorageInstance(createLocalDriver({ root: './uploads', baseUrl: '/uploads' }))
const onS3 = createStorageInstance(
  createS3Driver({ bucket: 'my-bucket', region: 'eu-central-1', accessKeyId: '...', secretAccessKey: '...' }),
)
const onR2 = createStorageInstance(
  createR2Driver({ accountId: '...', bucket: 'my-bucket', accessKeyId: '...', secretAccessKey: '...' }),
)
```

`onDisk.put('avatar.png', bytes)` and `onS3.put('avatar.png', bytes)` are the same call.

## Drivers per module

| Module | Named (`createX({ driver })`) | With options (`createXDriver(options)` into `createXInstance`) |
|---|---|---|
| `mail` | `console` | `createSmtpDriver` (needs `nodemailer`), `createResendDriver`, `createPostmarkDriver` |
| `storage` | `memory` | `createLocalDriver`, `createS3Driver`, `createR2Driver` |
| `cache` | `memory` | `createRedisDriver` (a Redis client), `createKvDriver` (a KV namespace) |
| `session` | `memory`, `cookie` (needs `secret`) | `createRedisDriver` into `createSessionManager` |
| `queue` | `memory` | `createRedisDriver`, `createCloudflareDriver` (a Queue binding) |
| `search` | `sqlite-fts` | `createMeilisearchDriver`, `createTypesenseDriver`; a custom driver into `createSearch({ driver })` |
| `db` | `sqlite` (bundled `better-sqlite3`) | none yet; `postgres`, `mysql` and `d1` are declared and throw |
| `logging` | `consoleTransport()` is the default | `fileTransport`, `externalTransport`, passed as `transports` |

## Swapping drivers per environment

Decide by what the environment provides. The memory driver in development and tests, Redis where `REDIS_URL` is set:

```ts
import { createCache, createCacheInstance, createRedisDriver } from '@loewen-digital/fullstack/cache'

declare const redis: Parameters<typeof createRedisDriver>[0]['client'] // ioredis or node-redis v4+

export const cache = process.env.REDIS_URL
  ? createCacheInstance(createRedisDriver({ client: redis, prefix: 'app:' }))
  : createCache({ driver: 'memory' })
```

## Writing a custom driver

Implement the interface and pass the object to `createXInstance`. A driver can wrap another one; this one namespaces every key, so two tenants share one store without seeing each other's entries:

```ts
import { createCacheInstance, createMemoryDriver, type CacheDriver } from '@loewen-digital/fullstack/cache'

function withPrefix(inner: CacheDriver, prefix: string): CacheDriver {
  return {
    get: <T>(key: string) => inner.get<T>(`${prefix}${key}`),
    set: (key, value, ttl) => inner.set(`${prefix}${key}`, value, ttl),
    has: (key) => inner.has(`${prefix}${key}`),
    delete: (key) => inner.delete(`${prefix}${key}`),
    flush: () => inner.flush(),
  }
}

const tenantCache = createCacheInstance(withPrefix(createMemoryDriver(), 'tenant-a:'))
```

Nothing has to be registered: a driver is a value, and the module only sees the interface.

## What a driver pulls in

The drivers are small and reach their service through `fetch`: Resend, Postmark, S3, R2, Meilisearch and Typesense need no SDK. The Redis, KV and Cloudflare Queue drivers take the client or binding you already have and import nothing. Two drivers load a package, and only when they are built: SMTP imports `nodemailer` on first send, the sqlite db driver requires `better-sqlite3` when `createDb` runs.
