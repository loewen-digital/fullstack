import { describe } from './describe.js'
import { withTimeout } from './timeout.js'
import type {
  ErrorReport,
  ErrorReporterConfig,
  ErrorReporterInstance,
  ErrorRuntime,
  ErrorSource,
  MonitoringFetch,
  ReportOptions,
  WaitUntil,
} from './types.js'

/** What a runtime adds to the reporter: the browser its breadcrumbs, route and noise filters */
export interface ReporterRuntime {
  runtime: ErrorRuntime
  /** Fills in what only the runtime knows, before a filter sees the report */
  complete?: (report: ErrorReport) => void
  /** The runtime's own filters; `true` drops the report */
  isNoise?: (report: ErrorReport) => boolean
  /** The `fetch` drivers send with, when it is not the global one */
  fetch?: MonitoringFetch
}

/** How the runtime hands an error over: with where it came from and when */
export interface CaptureOptions extends ReportOptions {
  source?: ErrorSource
  /** Milliseconds since the epoch of the moment the error happened (default: now) */
  at?: number
}

export interface Reporter extends ErrorReporterInstance {
  capture(error: unknown, options?: CaptureOptions): string
}

const REFERENCE = /^[\w.:-]{1,64}$/

/** 32 hex characters from the runtime's random source; `randomUUID` is missing on http pages */
export function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function keepAlive(waitUntil: WaitUntil | undefined, delivery: Promise<void>): void {
  if (!waitUntil) return
  if (typeof waitUntil === 'function') waitUntil(delivery)
  else waitUntil.waitUntil(delivery)
}

export function createReporter(config: ErrorReporterConfig, runtime: ReporterRuntime): Reporter {
  const { driver } = config
  const timeout = config.timeout ?? 5000
  const maxPerMinute = config.maxPerMinute ?? 30
  const send: MonitoringFetch =
    config.fetch ?? runtime.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const pending = new Set<Promise<void>>()
  let windowStart = 0
  let inWindow = 0

  function tell(error: unknown): void {
    try {
      if (config.onError) config.onError(error)
      else console.error('monitoring: a report was not delivered', error)
    } catch {
      // A reporter never throws, also not through the function that is told about a failure.
    }
  }

  /** An error that repeats in a loop must not take the server it reports to down with it */
  function admit(now: number): boolean {
    if (now - windowStart >= 60_000) {
      windowStart = now
      inWindow = 0
    }
    inWindow++
    return inWindow <= maxPerMinute
  }

  async function deliver(report: ErrorReport): Promise<void> {
    if (!driver) return
    try {
      await withTimeout(timeout, `the delivery through "${driver.name}"`, (signal) =>
        driver.send(report, { fetch: send, signal }),
      )
    } catch (error) {
      tell(error)
    }
  }

  function capture(error: unknown, options: CaptureOptions = {}): string {
    let reference = ''
    try {
      reference =
        typeof options.reference === 'string' && REFERENCE.test(options.reference)
          ? options.reference
          : newReference()
      if (!driver) return reference

      const now = Date.now()
      const report: ErrorReport = {
        reference,
        timestamp: new Date(options.at ?? now).toISOString(),
        ...describe(error),
        handled: options.handled ?? true,
        source: options.source ?? 'report',
        runtime: runtime.runtime,
        ...(config.environment === undefined ? {} : { environment: config.environment }),
        ...(config.release === undefined ? {} : { release: config.release }),
        route: options.route ?? null,
        ...(options.method === undefined ? {} : { method: options.method.toUpperCase() }),
        breadcrumbs: [],
        tags: { ...config.tags, ...options.tags },
      }
      runtime.complete?.(report)
      if (runtime.isNoise?.(report)) return reference
      if (config.filter && !config.filter(report)) return reference
      if (!admit(now)) return reference

      const delivery = deliver(report)
      pending.add(delivery)
      void delivery.then(() => pending.delete(delivery))
      keepAlive(options.waitUntil, delivery)
    } catch (failure) {
      tell(failure)
    }
    return reference
  }

  return {
    capture,
    report: (error, options) => capture(error, options),
    async flush() {
      while (pending.size > 0) await Promise.all(pending)
    },
  }
}
