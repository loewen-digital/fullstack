/**
 * Fake queue driver — captures dispatched jobs and can run them synchronously.
 *
 * Usage:
 *   const fakeQueue = createFakeQueueDriver()
 *   const queue = createQueueInstance(fakeQueue)
 *
 *   queue.handle('send-email', async (job) => { ... })
 *   await queue.dispatch({ name: 'send-email', payload: { to: 'user@example.com' } })
 *
 *   expect(fakeQueue.dispatched).toHaveLength(1)
 *   expect(fakeQueue.dispatched[0].name).toBe('send-email')
 *
 *   // Run all queued jobs synchronously
 *   await queue.process()
 *   expect(fakeQueue.dispatched).toHaveLength(0)
 */

import type { QueueDriver, Job } from '../queue/index.js'

export interface FakeQueueDriver extends QueueDriver {
  /** All jobs dispatched since creation or last clear() */
  readonly dispatched: Job[]
  /** Jobs that have failed processing */
  readonly failedJobs: Job[]
  /** Clear all captured jobs */
  clear(): void
}

export function createFakeQueueDriver(): FakeQueueDriver {
  const dispatched: Job[] = []
  const pending: Job[] = []
  const failedList: Job[] = []
  const processing = new Map<string, Job>()

  return {
    dispatched,
    failedJobs: failedList,

    async push(job: Job): Promise<void> {
      dispatched.push(job)
      pending.push(job)
    },

    async pop(): Promise<Job | null> {
      const job = pending.shift() ?? null
      if (job) processing.set(job.id, job)
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
        pending.push({ ...job, attempts: job.attempts + 1 })
      } else {
        failedList.push(job)
      }
    },

    async size(): Promise<number> {
      return pending.length
    },

    async failed(): Promise<Job[]> {
      return [...failedList]
    },

    async retry(jobId: string): Promise<void> {
      const index = failedList.findIndex(j => j.id === jobId)
      if (index === -1) return
      const job = failedList.splice(index, 1)[0]!
      pending.push({ ...job, attempts: 0 } as Job)
    },

    async flush(): Promise<void> {
      dispatched.length = 0
      pending.length = 0
      failedList.length = 0
      processing.clear()
    },

    clear(): void {
      dispatched.length = 0
      pending.length = 0
      failedList.length = 0
      processing.clear()
    },
  }
}
