import { describe, it, expect, vi } from 'vite-plus/test'
import { createHealthHandler, heartbeat } from '../index.js'
import type { MonitoringFetch } from '../index.js'

const MONITOR = 'https://monitor.example/api/0/organizations/acme/heartbeat_check/1b2c/'

describe('heartbeat', () => {
  it('pings the monitor and answers that it took the ping', async () => {
    const send = vi.fn<MonitoringFetch>(async () => new Response(null, { status: 200 }))

    expect(await heartbeat(MONITOR, { fetch: send })).toBe(true)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toBe(MONITOR)
    expect(send.mock.calls[0]?.[1]?.method).toBe('POST')
  })

  it('pings with the method the monitor expects', async () => {
    const send = vi.fn<MonitoringFetch>(async () => new Response(null))

    await heartbeat(MONITOR, { fetch: send, method: 'GET' })

    expect(send.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it('does nothing without an address', async () => {
    const send = vi.fn<MonitoringFetch>()

    expect(await heartbeat(undefined, { fetch: send })).toBe(false)
    expect(await heartbeat('', { fetch: send })).toBe(false)

    expect(send).not.toHaveBeenCalled()
  })

  it('answers false for a monitor that refuses, and never throws', async () => {
    expect(
      await heartbeat(MONITOR, { fetch: async () => new Response(null, { status: 404 }) }),
    ).toBe(false)
    expect(
      await heartbeat(MONITOR, {
        fetch: async () => {
          throw new TypeError('fetch failed')
        },
      }),
    ).toBe(false)
    expect(
      await heartbeat(MONITOR, {
        fetch() {
          throw new Error('not even a promise')
        },
      }),
    ).toBe(false)
  })

  it('gives up after the timeout and aborts the request', async () => {
    let signal: AbortSignal | null | undefined
    const started = Date.now()

    const took = await heartbeat(MONITOR, {
      timeout: 15,
      fetch(_input, init) {
        signal = init?.signal
        return new Promise(() => {})
      },
    })

    expect(took).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(signal?.aborted).toBe(true)
  })
})

describe('createHealthHandler', () => {
  const get = (method = 'GET'): Request => new Request('https://app.example/healthz', { method })

  it('answers 200 when every check passes', async () => {
    const health = createHealthHandler({
      checks: { storage: () => 'found', sessions: async () => true, nothing: () => undefined },
    })

    const response = await health(get())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
  })

  it('answers 200 for an app that names no checks', async () => {
    expect((await createHealthHandler()(get())).status).toBe(200)
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('bucket "notes-eu" is gone')
      },
    ],
    ['rejects', async () => Promise.reject(new Error('connection refused at 10.0.0.7'))],
    ['answers false', () => false],
    ['takes too long', () => new Promise(() => {})],
  ])('answers 503 when a check %s, and says nothing about it', async (_how, check) => {
    const failures: { name: string; error: unknown }[] = []
    const health = createHealthHandler({
      checks: { sessions: () => true, storage: check },
      timeout: 15,
      onFailure: (name, error) => failures.push({ name, error }),
    })

    const response = await health(get())
    const body = await response.text()

    expect(response.status).toBe(503)
    // The same word whatever failed: the endpoint is open, and its answer is no way to probe.
    expect(body).toBe('unavailable')
    expect([...response.headers.keys()].sort()).toEqual(['cache-control', 'content-type'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.name).toBe('storage')
    expect(failures[0]?.error).toBeInstanceOf(Error)
  })

  it('names the check that took too long to onFailure', async () => {
    const failures: unknown[] = []
    const health = createHealthHandler({
      checks: { storage: () => new Promise(() => {}) },
      timeout: 15,
      onFailure: (_name, error) => failures.push(error),
    })

    await health(get())

    expect((failures[0] as Error).message).toBe(
      'monitoring: the health check "storage" took longer than 15 ms',
    )
  })

  it('hands each check a signal that aborts when its time is up', async () => {
    let signal: AbortSignal | undefined
    const health = createHealthHandler({
      checks: {
        storage(given) {
          signal = given
          return new Promise(() => {})
        },
      },
      timeout: 15,
      onFailure: () => {},
    })

    await health(get())

    expect(signal?.aborted).toBe(true)
  })

  it('runs the checks side by side', async () => {
    const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))
    const health = createHealthHandler({ checks: { a: wait, b: wait, c: wait } })
    const started = Date.now()

    await health(get())

    expect(Date.now() - started).toBeLessThan(110)
  })

  it('logs a failed check with console.error when no onFailure is set', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const health = createHealthHandler({ checks: { storage: () => false } })

    const response = await health(get())

    expect(response.status).toBe(503)
    expect(logged).toHaveBeenCalledWith('health: check "storage" failed', expect.any(Error))
    logged.mockRestore()
  })

  it('answers although onFailure throws', async () => {
    const health = createHealthHandler({
      checks: { storage: () => false },
      onFailure() {
        throw new Error('the logger is broken too')
      },
    })

    expect((await health(get())).status).toBe(503)
  })

  it('answers HEAD without a body', async () => {
    const health = createHealthHandler({ checks: { storage: () => false } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await health(get('HEAD'))

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('')
    vi.restoreAllMocks()
  })

  it('refuses other methods without running a check', async () => {
    const check = vi.fn(() => true)
    const health = createHealthHandler({ checks: { storage: check } })

    const response = await health(get('POST'))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, HEAD')
    expect(check).not.toHaveBeenCalled()
  })
})
