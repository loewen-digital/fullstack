---
title: Cache
description: Key-value cache with TTL on memory, Redis or Cloudflare KV
---

# Cache

`createCache` gives a key-value cache with a TTL in seconds and a `remember` helper. The memory driver is built in; Redis and Cloudflare KV drivers take the client or binding you already have.

## Import

```ts
import { createCache } from '@loewen-digital/fullstack/cache'
```

## Basic usage

```ts
import { createCache } from '@loewen-digital/fullstack/cache'

const cache = createCache({ driver: 'memory', ttl: '5m' })

async function featured(posts: string[]) {
  await cache.set('featured-posts', posts, 300) // TTL in seconds; omitted = config.ttl, none = no expiry
  const cached = await cache.get<string[]>('featured-posts') // null when missing or expired
  const exists = await cache.has('featured-posts')
  const removed = await cache.delete('featured-posts') // true when it existed
  await cache.flush()
  return { cached, exists, removed }
}
```

## Remember

`remember(key, ttl, fn)` returns the cached value or computes, stores and returns it. A cached `null` counts as a miss.

```ts
async function loadFeatured(): Promise<string[]> {
  return ['hello-world'] // your query
}

async function featuredPosts() {
  return cache.remember('featured-posts', 300, loadFeatured)
}
```

## Drivers

The memory driver comes from `createCache({ driver: 'memory' })`. Redis and KV are built with their factories and handed to `createCacheInstance`; both prefix keys (`cache:` by default) so one store can serve several caches.

```ts
import { createCacheInstance, createRedisDriver, createKvDriver } from '@loewen-digital/fullstack/cache'

declare const redis: Parameters<typeof createRedisDriver>[0]['client'] // ioredis or node-redis v4+
declare const CACHE_KV: Parameters<typeof createKvDriver>[0]['namespace'] // a KV binding on Workers

const onRedis = createCacheInstance(createRedisDriver({ client: redis, prefix: 'app:' }), 600)
const onKv = createCacheInstance(createKvDriver({ namespace: CACHE_KV }))
```

| Driver | Holds | Notes |
|---|---|---|
| `memory` | a `Map` in the process | lost on restart, per isolate on Workers; the default for tests |
| `createRedisDriver({ client, prefix? })` | Redis | `client` needs `get`, `set`, `del`, `exists`, `flushdb`; values are JSON |
| `createKvDriver({ namespace, prefix? })` | Cloudflare KV | `expirationTtl` needs at least 60 seconds on KV; values are JSON |

A custom driver implements `CacheDriver` (`get`, `set`, `has`, `delete`, `flush`); the [driver pattern](/core-concepts/driver-pattern) page shows one.

## Config options

`createCache(config)` reads these; `createCacheInstance(driver, defaultTtl?)` takes the default TTL as a number of seconds.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory'` | — | Naming `redis` or `kv` here throws and points to the driver factory |
| `ttl` | `string` | none | Default TTL for `set` without one: `'90'`, `'5m'`, `'2h'`, `'1d'` (an unparseable string is one hour) |
