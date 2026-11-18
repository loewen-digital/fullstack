import { describe, it, expect, vi } from 'vite-plus/test'
import { createConsoleDriver, createErrorReporter, MonitoringError } from '../index.js'
import type { ErrorReport, ErrorReportDriver } from '../index.js'
import { createFakeErrorDriver } from '../../testing/index.js'

/** A driver whose delivery never ends, as a server that takes the connection and stays silent */
function hangingDriver(): ErrorReportDriver {
  return { name: 'hanging', send: () => new Promise(() => {}) }
}

describe('createErrorReporter', () => {
  it('hands the driver a report with what was thrown and what the app said about it', async () => {
    const driver = createFakeErrorDriver()
    const reporter = createErrorReporter({
      driver,
      environment: 'production',
      release: '1.4.0',
      tags: { app: 'notes' },
    })

    const error = new TypeError('no items')
    const reference = reporter.report(error, {
      route: '/items/[id]',
      method: 'get',
      tags: { job: 'none' },
    })
    await reporter.flush()

    expect(reference).toMatch(/^[0-9a-f]{32}$/)
    const report = driver.last()!
    expect(report).toMatchObject({
      reference,
      type: 'TypeError',
      message: 'no items',
      handled: true,
      source: 'report',
      runtime: 'server',
      environment: 'production',
      release: '1.4.0',
      route: '/items/[id]',
      method: 'GET',
      causes: [],
      breadcrumbs: [],
      tags: { app: 'notes', job: 'none' },
    })
    expect(report.frames[0]?.file).toContain('reporter.test')
    expect(report.frames[0]?.line).toBeGreaterThan(0)
    expect(Date.parse(report.timestamp)).not.toBeNaN()
    expect(report.userAgent).toBeUndefined()
  })

  it('sends nothing without a driver and still answers a reference', async () => {
    const reporter = createErrorReporter({ driver: undefined })

    const reference = reporter.report(new Error('boom'))
    await reporter.flush()

    expect(reference).toMatch(/^[0-9a-f]{32}$/)
  })

  it('takes a reference of the app, and makes one when it is not usable', async () => {
    const driver = createFakeErrorDriver()
    const reporter = createErrorReporter({ driver })

    expect(reporter.report(new Error('a'), { reference: '8a1b2c3d4e5f-FRA' })).toBe(
      '8a1b2c3d4e5f-FRA',
    )
    expect(reporter.report(new Error('b'), { reference: 'has spaces\nand a line' })).toMatch(
      /^[0-9a-f]{32}$/,
    )
    await reporter.flush()

    expect(driver.reports.map((report) => report.reference)).toEqual([
      '8a1b2c3d4e5f-FRA',
      expect.stringMatching(/^[0-9a-f]{32}$/),
    ])
  })

  it('marks an error nothing caught', async () => {
    const driver = createFakeErrorDriver()
    const reporter = createErrorReporter({ driver })

    reporter.report(new Error('boom'), { handled: false })
    await reporter.flush()

    expect(driver.last()?.handled).toBe(false)
  })

  it('names the chain of causes, nearest first', async () => {
    const driver = createFakeErrorDriver()
    const reporter = createErrorReporter({ driver })
    const root = new RangeError('disk full')
    const middle = new Error('could not save', { cause: root })

    reporter.report(new Error('request failed', { cause: middle }))
    await reporter.flush()

    expect(driver.last()?.causes.map((cause) => `${cause.type}: ${cause.message}`)).toEqual([
      'Error: could not save',
      'RangeError: disk full',
    ])
  })

  it('ends a chain of causes that leads back to itself', async () => {
    const driver = createFakeErrorDriver()
    const reporter = createErrorReporter({ driver })
    const first = new Error('first')
    const second = new Error('second', { cause: first })
    first.cause = second

    reporter.report(first)
    await reporter.flush()

    expect(driver.last()?.causes.map((cause) => cause.message)).toEqual(['second'])
  })

  describe('what a report leaves out', () => {
    it('takes the query string off an address in the message', async () => {
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver })

      reporter.report(
        new Error(
          'GET https://app.example/items/42?token=secret&user=ada failed, then /api/items?owner=ada too',
        ),
      )
      await reporter.flush()

      expect(driver.last()?.message).toBe(
        'GET https://app.example/items/42 failed, then /api/items too',
      )
    })

    it('names the keys of an object that was thrown, never its values', async () => {
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver })

      reporter.report({ email: 'ada@example.com', status: 422 })
      await reporter.flush()

      expect(driver.last()).toMatchObject({
        type: 'Error',
        message: 'Object thrown with keys: email, status',
        frames: [],
      })
      expect(JSON.stringify(driver.last())).not.toContain('ada@example.com')
    })

    it('reports a string, a number and nothing at all that was thrown', async () => {
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver })

      reporter.report('out of stock')
      reporter.report(404)
      reporter.report(undefined)
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual([
        'out of stock',
        'number thrown: 404',
        'undefined thrown: undefined',
      ])
    })

    it('cuts a message after 1000 characters', async () => {
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver })

      reporter.report(new Error('x'.repeat(5000)))
      await reporter.flush()

      expect(driver.last()?.message).toHaveLength(1000)
    })
  })

  describe('never throws and never holds up', () => {
    it('answers at once while the delivery is still under way', async () => {
      let delivered = false
      const driver: ErrorReportDriver = {
        name: 'slow',
        async send() {
          await new Promise((resolve) => setTimeout(resolve, 20))
          delivered = true
        },
      }
      const reporter = createErrorReporter({ driver })

      const reference = reporter.report(new Error('boom'))

      expect(reference).toMatch(/^[0-9a-f]{32}$/)
      expect(delivered).toBe(false)
      await reporter.flush()
      expect(delivered).toBe(true)
    })

    it('hands the delivery to waitUntil, as a function and as the object that has it', async () => {
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver })
      const kept: Promise<unknown>[] = []
      // The method of a Worker's context throws when it is called without the context.
      const ctx = {
        kept,
        waitUntil(this: { kept: Promise<unknown>[] }, promise: Promise<unknown>) {
          this.kept.push(promise)
        },
      }

      reporter.report(new Error('a'), { waitUntil: (promise) => kept.push(promise) })
      reporter.report(new Error('b'), { waitUntil: ctx })
      await Promise.all(kept)

      expect(kept).toHaveLength(2)
      expect(driver.reports).toHaveLength(2)
    })

    it('delivers although waitUntil throws', async () => {
      const driver = createFakeErrorDriver()
      const onError = vi.fn()
      const reporter = createErrorReporter({ driver, onError })

      const reference = reporter.report(new Error('boom'), {
        waitUntil: () => {
          throw new TypeError('Illegal invocation')
        },
      })
      await reporter.flush()

      expect(reference).toMatch(/^[0-9a-f]{32}$/)
      expect(driver.reports).toHaveLength(1)
      expect(onError).toHaveBeenCalledWith(expect.any(TypeError))
    })

    it('tells onError what a delivery failed with', async () => {
      const driver = createFakeErrorDriver()
      driver.fail('the server is down')
      const onError = vi.fn()
      const reporter = createErrorReporter({ driver, onError })

      expect(() => reporter.report(new Error('boom'))).not.toThrow()
      await reporter.flush()

      expect(onError).toHaveBeenCalledTimes(1)
      expect((onError.mock.calls[0]![0] as Error).message).toBe('the server is down')
    })

    it('survives a driver that throws instead of rejecting', async () => {
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: {
          name: 'broken',
          send() {
            throw new Error('not even a promise')
          },
        },
        onError,
      })

      expect(() => reporter.report(new Error('boom'))).not.toThrow()
      await reporter.flush()

      expect(onError).toHaveBeenCalledTimes(1)
    })

    it('gives up on a delivery after the timeout', async () => {
      const onError = vi.fn()
      const reporter = createErrorReporter({ driver: hangingDriver(), timeout: 15, onError })

      reporter.report(new Error('boom'))
      await reporter.flush()

      const failure = onError.mock.calls[0]![0] as Error
      expect(failure).toBeInstanceOf(MonitoringError)
      expect(failure.message).toBe(
        'monitoring: the delivery through "hanging" took longer than 15 ms',
      )
    })

    it('aborts the signal it gave the driver when the time is up', async () => {
      let signal: AbortSignal | undefined
      const reporter = createErrorReporter({
        driver: {
          name: 'listening',
          send(_report, context) {
            signal = context.signal
            return new Promise(() => {})
          },
        },
        timeout: 15,
        onError: () => {},
      })

      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(signal?.aborted).toBe(true)
    })

    it('survives a value whose properties throw when they are read', async () => {
      const driver = createFakeErrorDriver()
      const onError = vi.fn()
      const reporter = createErrorReporter({ driver, onError })
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('do not look at me')
          },
          ownKeys() {
            throw new Error('nor at my keys')
          },
        },
      )

      expect(() => reporter.report(hostile)).not.toThrow()
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
      expect(onError).toHaveBeenCalledTimes(1)
    })

    it('survives an onError that throws', async () => {
      const driver = createFakeErrorDriver()
      driver.fail()
      const reporter = createErrorReporter({
        driver,
        onError() {
          throw new Error('the logger is broken too')
        },
      })

      expect(() => reporter.report(new Error('boom'))).not.toThrow()
      await expect(reporter.flush()).resolves.toBeUndefined()
    })

    it('logs a failed delivery with console.error when no onError is set', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const driver = createFakeErrorDriver()
      driver.fail('the server is down')
      const reporter = createErrorReporter({ driver })

      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(logged).toHaveBeenCalledWith(
        'monitoring: a report was not delivered',
        expect.any(Error),
      )
      logged.mockRestore()
    })
  })

  describe('what is not sent', () => {
    it('drops a report the filter refuses, and still answers a reference', async () => {
      const driver = createFakeErrorDriver()
      const seen: ErrorReport[] = []
      const reporter = createErrorReporter({
        driver,
        filter(report) {
          seen.push(report)
          return report.type !== 'AbortError'
        },
      })
      const aborted = new Error('The operation was aborted')
      aborted.name = 'AbortError'

      const reference = reporter.report(aborted)
      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(reference).toMatch(/^[0-9a-f]{32}$/)
      expect(seen).toHaveLength(2)
      expect(driver.reports.map((report) => report.message)).toEqual(['boom'])
    })

    it('stops after maxPerMinute and starts again with the next minute', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
      const driver = createFakeErrorDriver()
      const reporter = createErrorReporter({ driver, maxPerMinute: 2 })

      reporter.report(new Error('1'))
      reporter.report(new Error('2'))
      reporter.report(new Error('3'))
      vi.setSystemTime(new Date('2026-11-18T10:01:00Z'))
      reporter.report(new Error('4'))
      await reporter.flush()
      vi.useRealTimers()

      expect(driver.reports.map((report) => report.message)).toEqual(['1', '2', '4'])
    })
  })
})

describe('createConsoleDriver', () => {
  it('prints a report as it would be sent', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = createErrorReporter({ driver: createConsoleDriver() })

    const reference = reporter.report(new TypeError('no items', { cause: new Error('offline') }), {
      route: '/items/[id]',
      method: 'GET',
    })
    await reporter.flush()

    const text = logged.mock.calls[0]?.[0] as string
    logged.mockRestore()
    expect(text).toContain(`[error report ${reference}] TypeError: no items`)
    expect(text).toContain('    in GET /items/[id]')
    expect(text).toMatch(/\n {4}at .*reporter\.test/)
    expect(text).toContain('  caused by Error: offline')
  })
})
