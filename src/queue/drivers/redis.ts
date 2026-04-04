import type { QueueDriver, Job } from '../types.js'

export interface RedisQueueDriverOptions {
  /** A Redis client instance (ioredis or node-redis v4+) */
  client: {
    lpush(key: string, value: string): Promise<number>
    rpop(key: string): Promise<string | null>
    llen(key: string): Promise<number>
    lrange(key: string, start: number, stop: number): Promise<string[]>
    del(key: string | string[]): Promise<number>
    set(key: string, value: string): Promise<unknown>
    get(key: string): Promise<string | null>
    hset(key: string, field: string, value: string): Promise<number>
    hget(key: string, field: string): Promise<string | null>
    hdel(key: string, field: string): Promise<number>
    hvals(key: string): Promise<string[]>
  }
  /** Key prefix for queue keys */
  prefix?: string
}

/**
 * Redis-backed queue driver.
 *
 * Uses Redis lists for pending jobs and hashes for failed jobs.
 */
export function createRedisDriver(options: RedisQueueDriverOptions): QueueDriver {
  const client = options.client
  const prefix = options.prefix ?? 'queue:'
  const pendingKey = `${prefix}pending`
  const failedKey = `${prefix}failed`
  const processingKey = `${prefix}processing`

  function serialize(job: Job): string {
    return JSON.stringify({ ...job, createdAt: job.createdAt.toISOString() })
  }

  function deserialize(raw: string): Job {
    const data = JSON.parse(raw)
    return { ...data, createdAt: new Date(data.createdAt) }
  }

  return {
    async push(job: Job): Promise<void> {
      await client.lpush(pendingKey, serialize(job))
    },

    async pop(): Promise<Job | null> {
      const raw = await client.rpop(pendingKey)
      if (!raw) return null
      const job = deserialize(raw)
      // Track in processing set
      await client.hset(processingKey, job.id, raw)
      return job
    },

    async complete(jobId: string): Promise<void> {
      await client.hdel(processingKey, jobId)
    },

    async fail(jobId: string, _error: Error): Promise<void> {
      const raw = await client.hget(processingKey, jobId)
      if (!raw) return
      await client.hdel(processingKey, jobId)
      const job = deserialize(raw)

      if (job.attempts < job.maxAttempts) {
        await client.lpush(pendingKey, serialize({ ...job, attempts: job.attempts + 1 }))
      } else {
        await client.hset(failedKey, jobId, serialize(job))
      }
    },

    async size(): Promise<number> {
      return client.llen(pendingKey)
    },

    async failed(): Promise<Job[]> {
      const values = await client.hvals(failedKey)
      return values.map(deserialize)
    },

    async retry(jobId: string): Promise<void> {
      const raw = await client.hget(failedKey, jobId)
      if (!raw) return
      await client.hdel(failedKey, jobId)
      const job = deserialize(raw)
      await client.lpush(pendingKey, serialize({ ...job, attempts: 0 }))
    },

    async flush(): Promise<void> {
      await client.del([pendingKey, failedKey, processingKey])
    },
  }
}
