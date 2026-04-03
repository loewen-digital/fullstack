import { describe, it, expect, vi } from 'vitest'
import { createLogger } from '../index.js'
import type { LogEntry, LogTransport } from '../types.js'

function captureTransport(): { transport: LogTransport; entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const transport: LogTransport = { log: (e) => { entries.push(e) } }
  return { transport, entries }
}

describe('createLogger', () => {
  it('emits a log entry with correct shape', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({ transports: [transport] })
    logger.info('hello world')

    expect(entries).toHaveLength(1)
    expect(entries[0]!.level).toBe('info')
    expect(entries[0]!.message).toBe('hello world')
    expect(entries[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('respects minimum log level', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({ transports: [transport], level: 'warn' })

    logger.debug('debug msg')
    logger.info('info msg')
    logger.warn('warn msg')
    logger.error('error msg')

    expect(entries).toHaveLength(2)
    expect(entries[0]!.level).toBe('warn')
    expect(entries[1]!.level).toBe('error')
  })

  it('includes context in log entry', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({ transports: [transport] })
    logger.info('test', { requestId: 'abc-123' })

    expect(entries[0]!.context).toEqual({ requestId: 'abc-123' })
  })

  it('merges base context with per-call context', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({
      transports: [transport],
      context: { app: 'myapp' },
    })
    logger.info('test', { userId: 1 })

    expect(entries[0]!.context).toEqual({ app: 'myapp', userId: 1 })
  })

  it('child logger inherits context', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({ transports: [transport] })
    const child = logger.child({ module: 'auth' })
    child.warn('unauthorized')

    expect(entries[0]!.context).toEqual({ module: 'auth' })
  })

  it('child overrides parent context keys', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({
      transports: [transport],
      context: { env: 'test' },
    })
    const child = logger.child({ module: 'auth' })
    child.info('login', { userId: 99 })

    expect(entries[0]!.context).toEqual({ env: 'test', module: 'auth', userId: 99 })
  })

  it('supports all log levels', () => {
    const { transport, entries } = captureTransport()
    const logger = createLogger({ transports: [transport] })

    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    logger.fatal('f')

    expect(entries.map((e) => e.level)).toEqual(['debug', 'info', 'warn', 'error', 'fatal'])
  })

  it('calls multiple transports', () => {
    const { transport: t1, entries: e1 } = captureTransport()
    const { transport: t2, entries: e2 } = captureTransport()
    const logger = createLogger({ transports: [t1, t2] })
    logger.info('broadcast')

    expect(e1).toHaveLength(1)
    expect(e2).toHaveLength(1)
  })

  it('does not crash when an async transport rejects', async () => {
    const badTransport: LogTransport = {
      log: async () => { throw new Error('transport error') },
    }
    const logger = createLogger({ transports: [badTransport] })
    // Should not throw synchronously
    expect(() => logger.error('oops')).not.toThrow()
    // Give the promise a tick to settle
    await new Promise((r) => setTimeout(r, 10))
  })
})
