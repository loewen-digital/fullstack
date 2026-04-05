---
title: Driver Pattern
description: How the driver pattern enables swappable backends in @loewen-digital/fullstack
---

# Driver Pattern

Every module with I/O — mail, storage, cache, sessions, queues, search — uses a **driver pattern**. You choose a driver at configuration time. The rest of your application code never changes when you swap backends.

## What is a driver?

A driver is an object that implements a well-defined interface. For example, the `StorageDriver` interface looks like this:

```ts
interface StorageDriver {
  get(key: string): Promise<ReadableStream | null>
  put(key: string, data: ReadableStream | Uint8Array | string, meta?: FileMeta): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
  getUrl(key: string): Promise<string>
}
```

The `createStorage()` factory accepts a driver name. Under the hood, it loads the corresponding implementation dynamically:

```ts
const storage = createStorage({ driver: 'local', local: { root: './uploads' } })
const storage = createStorage({ driver: 's3', s3: { bucket: 'my-bucket', region: 'us-east-1' } })
const storage = createStorage({ driver: 'r2', r2: { bucket: 'my-bucket', accountId: '...' } })
const storage = createStorage({ driver: 'memory' }) // great for tests
```

The `storage.put()`, `storage.get()`, `storage.delete()` calls are identical regardless of which driver is active.

## Available drivers per module

| Module | Drivers |
|---|---|
| `mail` | `console`, `smtp`, `resend`, `postmark` |
| `storage` | `local`, `s3`, `r2`, `memory` |
| `cache` | `memory`, `redis`, `kv` |
| `session` | `cookie`, `memory`, `redis` |
| `queue` | `memory`, `redis`, `database` |
| `search` | `sqlite-fts`, `meilisearch`, `typesense` |
| `logging` | `console`, `file`, `http` |
| `db` | `sqlite`, `postgres`, `mysql` |

## Swapping drivers per environment

The canonical pattern is to use lightweight drivers in development and real services in production:

```ts
const cache = createCache({
  driver: process.env.REDIS_URL ? 'redis' : 'memory',
  redis: { url: process.env.REDIS_URL },
})

const mail = createMail({
  driver: process.env.NODE_ENV === 'production' ? 'resend' : 'console',
  resend: { apiKey: process.env.RESEND_API_KEY! },
  from: { name: 'My App', address: 'hello@example.com' },
})
```

## Writing a custom driver

You can implement any driver interface yourself and pass it directly to the factory:

```ts
import type { CacheDriver } from '@loewen-digital/fullstack/cache'

const upstashDriver: CacheDriver = {
  async get(key) { /* ... */ },
  async set(key, value, ttl) { /* ... */ },
  async delete(key) { /* ... */ },
  async has(key) { /* ... */ },
  async flush() { /* ... */ },
}

const cache = createCache({ driver: upstashDriver })
```

This makes it easy to support any backend without waiting for an official driver to be released.

## Dynamic imports

Drivers are loaded with dynamic `import()` under the hood. This means driver code that you don't use is not included in your bundle. If you never configure the `s3` driver, the AWS SDK is never imported.

```ts
// Internal implementation sketch
const driver = await import(
  config.driver === 's3'    ? './drivers/s3.js'    :
  config.driver === 'r2'    ? './drivers/r2.js'    :
  config.driver === 'local' ? './drivers/local.js' :
                              './drivers/memory.js'
)
```
