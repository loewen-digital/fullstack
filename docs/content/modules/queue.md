---
title: Queue
description: Dispatch jobs, process them with registered handlers, retries and a dead-letter list
---

# Queue

`createQueue` takes jobs by name and payload, keeps them in a driver, and `process()` runs the registered handlers over everything pending. A failed job is retried until `maxAttempts`, then lands in `failed()`. The memory driver is built in; Redis and Cloudflare Queues take the client or binding you have.

## Import

```ts
import { createQueue } from '@loewen-digital/fullstack/queue'
```

## Basic usage

```ts
import { createQueue } from '@loewen-digital/fullstack/queue'

export const queue = createQueue({ driver: 'memory' })

queue.handle<{ userId: number }>('send-welcome-email', async (job) => {
  console.log('welcome', job.payload.userId, `attempt ${job.attempts + 1} of ${job.maxAttempts}`)
})

async function register(userId: number) {
  const job = await queue.dispatch({ name: 'send-welcome-email', payload: { userId } })
  return job.id
}
```

`dispatch` returns the `Job` (`id`, `name`, `payload`, `attempts`, `maxAttempts`, `backoff`, `timeout`, `createdAt`). A job whose name has no handler fails when processed.

## Processing

`process()` pops jobs until the queue is empty, runs the handler for each, and marks it completed or failed. Nothing runs in the background: call `process()` from a scheduler, a cron Worker, or right after the response that dispatched the work.

```ts
async function drain() {
  await queue.process()
  return queue.size() // 0
}

setInterval(() => void queue.process(), 5_000) // a simple worker loop in a Node process
```

Concurrency is one job at a time per `process()` call.

## Retries and failed jobs

A handler that throws fails the job. With attempts left it is re-enqueued with `attempts + 1`; at `maxAttempts` it moves to the dead-letter list. `retry(id)` puts a failed job back with `attempts` reset.

```ts
async function inspectFailures() {
  const failed = await queue.failed() // Job[]
  for (const job of failed) await queue.retry(job.id)
  await queue.flush() // drop pending and failed jobs
}
```

`backoff`, `timeout` and `delay` on a job definition are stored on the job but not enforced by the memory and Redis drivers: a retry is available immediately and a handler is not cut off.

## Drivers

```ts
import { createQueueInstance, createRedisDriver, createCloudflareDriver } from '@loewen-digital/fullstack/queue'

declare const redis: Parameters<typeof createRedisDriver>[0]['client'] // ioredis or node-redis v4+
declare const JOBS: Parameters<typeof createCloudflareDriver>[0]['queue'] // a Queue binding on Workers

const onRedis = createQueueInstance(createRedisDriver({ client: redis, prefix: 'app:queue:' }))
const onCloudflare = createQueueInstance(createCloudflareDriver({ queue: JOBS }))
```

| Driver | Holds | Notes |
|---|---|---|
| `memory` (`createQueue({ driver: 'memory' })`) | arrays in the process | lost on restart; jobs show in the [Dev UI](/tooling/dev-ui) outside production |
| `createRedisDriver({ client, prefix? })` | Redis lists and hashes under `prefix` (`queue:`) | `client` needs `lpush`, `rpop`, `llen`, `lrange`, `hset`, `hget`, `hdel`, `hvals` |
| `createCloudflareDriver({ queue })` | a Cloudflare Queue | `dispatch` sends the job to the binding; your Worker's `queue()` consumer runs it. `process`, `retry` and `size` do nothing here, Cloudflare delivers and retries |

## Config options

`createQueue(config)` reads one option; the defaults for a job come from `dispatch`.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'memory'` | — | Naming `redis` or `cloudflare` here throws and points to the driver factory |

| Job definition | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Selects the handler |
| `payload` | `T` | — | Anything JSON-serializable |
| `maxAttempts` | `number` | `3` | Attempts before the job is failed for good |
| `backoff`, `timeout`, `delay` | `number` (seconds) | `60`, `30`, none | Stored on the job; not enforced by the bundled drivers |
