// Console transport — Task 2.2

import type { LogEntry, LogTransport } from '../types.js'

const LEVEL_COLORS: Record<string, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  fatal: '\x1b[35m', // magenta
}
const RESET = '\x1b[0m'

function devFormat(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level] ?? ''
  const level = `${color}${entry.level.toUpperCase().padEnd(5)}${RESET}`
  const ts = entry.timestamp.slice(11, 23) // HH:MM:SS.mmm
  const ctx = entry.context && Object.keys(entry.context).length > 0
    ? ' ' + JSON.stringify(entry.context)
    : ''
  return `${ts} ${level} ${entry.message}${ctx}`
}

export function consoleTransport(format?: 'dev' | 'prod'): LogTransport {
  const isDev = format
    ? format === 'dev'
    : (typeof process !== 'undefined' ? process.env.NODE_ENV !== 'production' : false)

  return {
    log(entry: LogEntry): void {
      const output = isDev ? devFormat(entry) : JSON.stringify(entry)
      if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(output)
      } else if (entry.level === 'warn') {
        console.warn(output)
      } else {
        console.log(output)
      }
    },
  }
}
