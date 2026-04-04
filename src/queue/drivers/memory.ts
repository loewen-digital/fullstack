import type { QueueDriver, Job } from '../types.js'

/**
 * In-memory queue driver.
 *
 * Jobs are stored in-memory and processed synchronously in order.
 * Suitable for development and testing.
 */
export function createMemoryDriver(): QueueDriver {
  const pending: Job[] = []
  const processing = new Map<string, Job>()
  const failedJobs: Job[] = []

  return {
    async push(job: Job): Promise<void> {
      pending.push(job)
    },

    async pop(): Promise<Job | null> {
      const job = pending.shift() ?? null
      if (job) {
        processing.set(job.id, job)
      }
      return job
    },

    async complete(jobId: string): Promise<void> {
      processing.delete(jobId)
    },

    async fail(jobId: string, _error: Error): Promise<void> {
      const job = processing.get(jobId)
      if (!job) return
      processing.delete(jobId)

      if (job.attempts < job.maxAttempts) {
        // Re-enqueue with incremented attempt count
        pending.push({ ...job, attempts: job.attempts + 1 })
      } else {
        // Move to dead letter queue
        failedJobs.push(job)
      }
    },

    async size(): Promise<number> {
      return pending.length
    },

    async failed(): Promise<Job[]> {
      return [...failedJobs]
    },

    async retry(jobId: string): Promise<void> {
      const index = failedJobs.findIndex(j => j.id === jobId)
      if (index === -1) return
      const job = failedJobs.splice(index, 1)[0]!
      pending.push({ ...job, attempts: 0 } as Job)
    },

    async flush(): Promise<void> {
      pending.length = 0
      processing.clear()
      failedJobs.length = 0
    },
  }
}
