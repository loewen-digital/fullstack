---
title: Queue
description: Background job processing with swappable drivers
---

# Queue

The `queue` module lets you dispatch work to a background queue and process it asynchronously. This is useful for sending emails, resizing images, syncing data, or any task that should not block an HTTP response.

## Import

```ts
import { createQueue } from '@loewen-digital/fullstack/queue'
```

## Basic usage

```ts
import { createQueue } from '@loewen-digital/fullstack/queue'

const queue = createQueue({ driver: 'memory' })

// Define a job handler
queue.register('send-welcome-email', async (payload: { userId: number }) => {
  const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, payload.userId) })
  await mail.send({ to: user.email, subject: 'Welcome!', text: 'Thanks for joining.' })
})

// Dispatch a job
await queue.dispatch('send-welcome-email', { userId: 42 })
```

## Job options

```ts
await queue.dispatch('send-welcome-email', { userId: 42 }, {
  delay: 5000,      // delay in milliseconds before the job becomes available
  retries: 3,       // retry up to 3 times on failure
  priority: 10,     // higher priority jobs run first
})
```

## Processing jobs

In a dedicated worker process or a background task:

```ts
// Process jobs continuously
await queue.work()

// Process a single batch and exit
await queue.runOnce()
```

## Error handling

```ts
queue.onError(async (error, job) => {
  logger.error('Job failed', { job: job.name, payload: job.payload, error })
})
```

## Driver options

| Driver | Description |
|---|---|
| `memory` | In-process queue. Jobs are lost on restart. Good for development and tests. |
| `database` | Persists jobs to the database. No extra infrastructure needed. |
| `redis` | High-performance Redis-backed queue. Requires `ioredis`. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory' \| 'database' \| 'redis'` | — | Queue driver |
| `concurrency` | `number` | `1` | Number of jobs to process concurrently |
| `retries` | `number` | `3` | Default retry count for failed jobs |
| `retryDelay` | `number` | `5000` | Milliseconds between retry attempts |
| `redis.url` | `string` | — | Redis connection URL |
| `database.table` | `string` | `'jobs'` | Database table name for queued jobs |
