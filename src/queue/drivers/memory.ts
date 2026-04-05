import type { QueueDriver, Job } from '../types.js'
import { devStorePushJob, devStoreUpdateJob, isDevMode } from '../../dev-store/index.js'

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

  // devStoreId maps internal job.id → devStore entry id (same value here)
  function trackJob(job: Job, status: 'pending' | 'processing' | 'completed' | 'failed', failedReason?: string): void {
    if (!isDevMode()) return
    devStorePushJob({
      name: job.name,
      payload: job.payload,
      status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      enqueuedAt: new Date().toISOString(),
      failedReason,
    })
  }

  return {
    async push(job: Job): Promise<void> {
      pending.push(job)
      trackJob(job, 'pending')
    },

    async pop(): Promise<Job | null> {
      const job = pending.shift() ?? null
      if (job) {
        processing.set(job.id, job)
        if (isDevMode()) devStoreUpdateJob(job.id, { status: 'processing' })
      }
      return job
    },

    async complete(jobId: string): Promise<void> {
      processing.delete(jobId)
      if (isDevMode()) devStoreUpdateJob(jobId, { status: 'completed' })
    },

    async fail(jobId: string, error: Error): Promise<void> {
      const job = processing.get(jobId)
      if (!job) return
      processing.delete(jobId)

      if (job.attempts < job.maxAttempts) {
        // Re-enqueue with incremented attempt count
        const retried = { ...job, attempts: job.attempts + 1 }
        pending.push(retried)
        if (isDevMode()) devStoreUpdateJob(jobId, { status: 'pending', attempts: retried.attempts })
      } else {
        // Move to dead letter queue
        failedJobs.push(job)
        if (isDevMode()) devStoreUpdateJob(jobId, { status: 'failed', failedReason: error.message })
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
      const retried = { ...job, attempts: 0 } as Job
      pending.push(retried)
      if (isDevMode()) devStoreUpdateJob(jobId, { status: 'pending', attempts: 0, failedReason: undefined })
    },

    async flush(): Promise<void> {
      pending.length = 0
      processing.clear()
      failedJobs.length = 0
    },
  }
}
