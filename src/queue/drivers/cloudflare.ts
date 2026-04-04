import type { QueueDriver, Job } from '../types.js'

export interface CloudflareQueueDriverOptions {
  /** Cloudflare Queue binding */
  queue: {
    send(message: unknown): Promise<void>
    sendBatch(messages: Array<{ body: unknown }>): Promise<void>
  }
}

/**
 * Cloudflare Queues driver.
 *
 * Uses Cloudflare Queues for job dispatch. Processing is handled
 * by the Cloudflare Workers queue consumer, not by this driver.
 *
 * Note: pop/complete/fail/retry are not supported in this driver
 * because Cloudflare Queues handles delivery and retries natively.
 */
export function createCloudflareDriver(options: CloudflareQueueDriverOptions): QueueDriver {
  const queue = options.queue
  const failedJobs: Job[] = []

  return {
    async push(job: Job): Promise<void> {
      await queue.send({
        id: job.id,
        name: job.name,
        payload: job.payload,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        backoff: job.backoff,
        timeout: job.timeout,
        createdAt: job.createdAt.toISOString(),
      })
    },

    async pop(): Promise<Job | null> {
      // Cloudflare handles message delivery via queue consumers
      return null
    },

    async complete(): Promise<void> {
      // Handled by Cloudflare queue consumer ack
    },

    async fail(_jobId: string, _error: Error): Promise<void> {
      // Cloudflare handles retries natively
    },

    async size(): Promise<number> {
      // Not supported — Cloudflare doesn't expose queue size
      return 0
    },

    async failed(): Promise<Job[]> {
      return [...failedJobs]
    },

    async retry(): Promise<void> {
      // Handled by Cloudflare natively
    },

    async flush(): Promise<void> {
      failedJobs.length = 0
    },
  }
}
