import { describe, it, expect, vi } from 'vitest'
import { createQueue, createQueueInstance, createMemoryDriver } from '../index.js'

describe('createQueue', () => {
  it('creates instance with memory driver', () => {
    const queue = createQueue({ driver: 'memory' })
    expect(queue).toBeDefined()
    expect(queue.dispatch).toBeInstanceOf(Function)
    expect(queue.process).toBeInstanceOf(Function)
  })

  it('throws on unknown driver', () => {
    expect(() => createQueue({ driver: 'unknown' })).toThrow('Unknown queue driver')
  })

  it('throws on redis driver without config', () => {
    expect(() => createQueue({ driver: 'redis' })).toThrow('Redis queue driver requires')
  })

  it('throws on cloudflare driver without config', () => {
    expect(() => createQueue({ driver: 'cloudflare' })).toThrow('Cloudflare queue driver requires')
  })
})

describe('queue dispatch and process', () => {
  it('dispatches a job', async () => {
    const queue = createQueue({ driver: 'memory' })
    const job = await queue.dispatch({ name: 'test-job', payload: { value: 42 } })
    expect(job.id).toBeDefined()
    expect(job.name).toBe('test-job')
    expect(job.payload).toEqual({ value: 42 })
    expect(job.attempts).toBe(0)
    expect(job.maxAttempts).toBe(3)
    expect(job.createdAt).toBeInstanceOf(Date)
  })

  it('processes a job with a handler', async () => {
    const queue = createQueue({ driver: 'memory' })
    const handler = vi.fn()
    queue.handle('greet', handler)

    await queue.dispatch({ name: 'greet', payload: { name: 'Alice' } })
    await queue.process()

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].payload).toEqual({ name: 'Alice' })
  })

  it('processes multiple jobs in order', async () => {
    const queue = createQueue({ driver: 'memory' })
    const results: number[] = []
    queue.handle('count', async (job) => {
      results.push(job.payload as number)
    })

    await queue.dispatch({ name: 'count', payload: 1 })
    await queue.dispatch({ name: 'count', payload: 2 })
    await queue.dispatch({ name: 'count', payload: 3 })
    await queue.process()

    expect(results).toEqual([1, 2, 3])
  })

  it('reports queue size', async () => {
    const queue = createQueue({ driver: 'memory' })
    expect(await queue.size()).toBe(0)
    await queue.dispatch({ name: 'job', payload: null })
    await queue.dispatch({ name: 'job', payload: null })
    expect(await queue.size()).toBe(2)
  })

  it('uses custom maxAttempts, backoff, timeout', async () => {
    const queue = createQueue({ driver: 'memory' })
    const job = await queue.dispatch({
      name: 'custom',
      payload: {},
      maxAttempts: 5,
      backoff: 120,
      timeout: 60,
    })
    expect(job.maxAttempts).toBe(5)
    expect(job.backoff).toBe(120)
    expect(job.timeout).toBe(60)
  })
})

describe('job failure and retry', () => {
  it('retries a failed job up to maxAttempts', async () => {
    const queue = createQueue({ driver: 'memory' })
    let callCount = 0
    queue.handle('flaky', () => {
      callCount++
      throw new Error('fail')
    })

    await queue.dispatch({ name: 'flaky', payload: null, maxAttempts: 3 })
    await queue.process() // attempt 0 → fails, re-enqueued as attempts=1
    await queue.process() // attempt 1 → fails, re-enqueued as attempts=2
    await queue.process() // attempt 2 → fails, re-enqueued as attempts=3
    await queue.process() // attempt 3 → 3 < 3 is false, moves to dead letter

    expect(callCount).toBe(4)
    const failed = await queue.failed()
    expect(failed).toHaveLength(1)
  })

  it('retries a failed job manually', async () => {
    const queue = createQueue({ driver: 'memory' })
    queue.handle('fail-once', () => { throw new Error('nope') })

    await queue.dispatch({ name: 'fail-once', payload: null, maxAttempts: 1 })
    await queue.process()

    const failed = await queue.failed()
    expect(failed).toHaveLength(1)

    // Retry the failed job
    await queue.retry(failed[0].id)
    expect(await queue.size()).toBe(1)

    const handler = vi.fn()
    queue.handle('fail-once', handler)
    await queue.process()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('fails job with no handler registered', async () => {
    const queue = createQueue({ driver: 'memory' })
    await queue.dispatch({ name: 'no-handler', payload: null, maxAttempts: 1 })
    await queue.process()
    const failed = await queue.failed()
    expect(failed).toHaveLength(1)
  })
})

describe('flush', () => {
  it('clears all jobs', async () => {
    const queue = createQueue({ driver: 'memory' })
    await queue.dispatch({ name: 'job', payload: null })
    await queue.dispatch({ name: 'job', payload: null })
    await queue.flush()
    expect(await queue.size()).toBe(0)
  })
})

describe('createQueueInstance', () => {
  it('works with a custom driver', async () => {
    const driver = createMemoryDriver()
    const queue = createQueueInstance(driver)
    const handler = vi.fn()
    queue.handle('test', handler)
    await queue.dispatch({ name: 'test', payload: 'data' })
    await queue.process()
    expect(handler).toHaveBeenCalledOnce()
  })
})
