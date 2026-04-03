// Logging module — Task 2.2

import type { LogLevel, LogEntry, LoggerConfig, LoggerInstance, LogTransport } from './types.js'
import { consoleTransport } from './transports/console.js'

export type { LogLevel, LogEntry, LogTransport, LoggerConfig, LoggerInstance } from './types.js'
export { consoleTransport } from './transports/console.js'
export { fileTransport } from './transports/file.js'
export { externalTransport } from './transports/external.js'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

export function createLogger(config: LoggerConfig = {}): LoggerInstance {
  const minLevel: LogLevel = config.level ?? 'debug'
  const baseContext = config.context ?? {}
  const transports: LogTransport[] = config.transports ?? [consoleTransport(config.format)]

  function emit(level: LogLevel, message: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(Object.keys(baseContext).length > 0 || (ctx && Object.keys(ctx).length > 0)
        ? { context: { ...baseContext, ...ctx } }
        : {}),
    }

    for (const transport of transports) {
      // Allow async transports but don't await — fire-and-forget
      const result = transport.log(entry)
      if (result instanceof Promise) {
        result.catch(() => { /* transport errors must not crash app */ })
      }
    }
  }

  function makeInstance(inheritedContext: Record<string, unknown>): LoggerInstance {
    return {
      debug: (msg, ctx) => emit('debug', msg, { ...inheritedContext, ...ctx }),
      info: (msg, ctx) => emit('info', msg, { ...inheritedContext, ...ctx }),
      warn: (msg, ctx) => emit('warn', msg, { ...inheritedContext, ...ctx }),
      error: (msg, ctx) => emit('error', msg, { ...inheritedContext, ...ctx }),
      fatal: (msg, ctx) => emit('fatal', msg, { ...inheritedContext, ...ctx }),
      child: (ctx) => makeInstance({ ...inheritedContext, ...ctx }),
    }
  }

  return makeInstance({})
}
