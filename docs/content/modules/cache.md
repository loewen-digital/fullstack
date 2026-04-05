---
title: Cache
description: Key-value caching with memory, Redis, and edge KV drivers
---

# Cache

The `cache` module provides a simple key-value cache with optional TTL support. It is useful for storing computed results, rate limit counters, or any data that should expire. Drivers include in-memory, Redis, and edge KV stores.

## Import

```ts
import { createCache } from '@loewen-digital/fullstack/cache'
```

## Basic usage

```ts
import { createCache } from '@loewen-digital/fullstack/cache'

const cache = createCache({ driver: 'memory' })

// Store a value (optional TTL in seconds)
await cache.set('featured-posts', posts, { ttl: 300 })

// Retrieve a value
const cached = await cache.get('featured-posts')

// Check existence without retrieving
const exists = await cache.has('featured-posts') // true

// Delete a key
await cache.delete('featured-posts')

// Clear all keys
await cache.flush()
```

## Remember pattern

The `remember` helper fetches from cache if available; otherwise calls the factory and stores the result:

```ts
const posts = await cache.remember('featured-posts', 300, async () => {
  return db.query.posts.findMany({ where: (p, { eq }) => eq(p.featured, true) })
})
```

## Incrementing counters

```ts
await cache.increment('api-calls:user:42')        // 1
await cache.increment('api-calls:user:42')        // 2
await cache.increment('api-calls:user:42', 5)     // 7
await cache.decrement('api-calls:user:42')        // 6
```

## Redis driver

```ts
const cache = createCache({
  driver: 'redis',
  redis: { url: process.env.REDIS_URL! },
})
```

## Driver options

| Driver | Description |
|---|---|
| `memory` | In-process `Map` with TTL support. Data is lost on restart. |
| `redis` | Redis-backed cache. Requires `ioredis` peer dependency. |
| `kv` | Cloudflare Workers KV or compatible edge KV store. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory' \| 'redis' \| 'kv'` | — | Cache driver |
| `prefix` | `string` | `''` | Key prefix applied to all cache entries |
| `redis.url` | `string` | — | Redis connection URL |
| `redis.tls` | `boolean` | `false` | Enable TLS for Redis connection |
