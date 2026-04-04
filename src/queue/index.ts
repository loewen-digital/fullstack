import type { QueueConfig } from '../config/types.js'
import type { QueueDriver, QueueInstance, Job, JobDefinition, JobHandler } from './types.js'
import { createMemoryDriver } from './drivers/memory.js'

export type { QueueConfig, QueueDriver, QueueInstance, Job, JobDefinition, JobHandler } from './types.js'
export { createMemoryDriver } from './drivers/memory.js'
export { createRedisDriver } from './drivers/redis.js'
export { createCloudflareDriver } from './drivers/cloudflare.js'

/**
 * Create a queue instance.
 *
 * Usage:
 *   const queue = createQueue({ driver: 'memory' })
 *   queue.handle('send-email', async (job) => { ... })
 *   await queue.dispatch({ name: 'send-email', payload: { to: 'user@example.com' } })
 *   await queue.process()
 */
export function createQueue(config: QueueConfig): QueueInstance {
  let driver: QueueDriver

  if (config.driver === 'memory') {
    driver = createMemoryDriver()
  } else if (config.driver === 'redis') {
    throw new Error(
      'Redis queue driver requires a Redis client. ' +
        'Import createRedisDriver from @loewen-digital/fullstack/queue and pass your client.',
    )
  } else if (config.driver === 'cloudflare') {
    throw new Error(
      'Cloudflare queue driver requires a Queue binding. ' +
        'Import createCloudflareDriver from @loewen-digital/fullstack/queue and pass your binding.',
    )
  } else if (typeof config.driver === 'object') {
    driver = config.driver as QueueDriver
  } else {
    throw new Error(`Unknown queue driver: "${config.driver}"`)
  }

  return createQueueInstance(driver)
}

/**
 * Low-level factory: create a queue instance from any QueueDriver.
 */
export function createQueueInstance(driver: QueueDriver): QueueInstance {
  const handlers = new Map<string, JobHandler>()

  return {
    async dispatch<T>(definition: JobDefinition<T>): Promise<Job<T>> {
      const job: Job<T> = {
        id: crypto.randomUUID(),
        name: definition.name,
        payload: definition.payload,
        attempts: 0,
        maxAttempts: definition.maxAttempts ?? 3,
        backoff: definition.backoff ?? 60,
        timeout: definition.timeout ?? 30,
        createdAt: new Date(),
      }

      await driver.push(job as Job)
      return job
    },

    handle<T = unknown>(name: string, handler: JobHandler<T>): void {
      handlers.set(name, handler as JobHandler)
    },

    async process(): Promise<void> {
      let job = await driver.pop()
      while (job) {
        const handler = handlers.get(job.name)
        if (handler) {
          try {
            await handler(job)
            await driver.complete(job.id)
          } catch (err) {
            await driver.fail(job.id, err instanceof Error ? err : new Error(String(err)))
          }
        } else {
          // No handler registered — fail the job
          await driver.fail(job.id, new Error(`No handler registered for job "${job.name}"`))
        }
        job = await driver.pop()
      }
    },

    size: () => driver.size(),
    failed: () => driver.failed(),
    retry: (jobId) => driver.retry(jobId),
    flush: () => driver.flush(),
  }
}
