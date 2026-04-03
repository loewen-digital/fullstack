// External/webhook transport — Task 2.2
// Sends log entries to an HTTP endpoint (Sentry, Logflare, custom webhook, etc.)

import type { LogEntry, LogTransport } from '../types.js'

export interface ExternalTransportConfig {
  /** Full URL to POST log entries to */
  url: string
  /** Extra headers (e.g. Authorization) */
  headers?: Record<string, string>
  /** Minimum level to forward. Default: 'error' */
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
}

const LEVEL_ORDER = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 }

export function externalTransport(config: ExternalTransportConfig): LogTransport {
  const minLevel = config.level ?? 'error'

  return {
    log(entry: LogEntry): void {
      if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[minLevel]) return

      // Fire-and-forget — don't block the calling code
      fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify(entry),
      }).catch(() => { /* swallow network errors in transport */ })
    },
  }
}
