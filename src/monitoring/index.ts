import { createReporter } from './reporter.js'
import type { ErrorReporterConfig, ErrorReporterInstance } from './types.js'

export type {
  Breadcrumb,
  ErrorCause,
  ErrorReport,
  ErrorReportContext,
  ErrorReportDriver,
  ErrorReporterConfig,
  ErrorReporterInstance,
  ErrorRuntime,
  ErrorSource,
  HealthCheck,
  HealthHandler,
  HealthHandlerConfig,
  HeartbeatOptions,
  MonitoringFetch,
  ReportOptions,
  SentryDriverConfig,
  StackFrame,
  WaitUntil,
} from './types.js'
export type {
  SentryBreadcrumb,
  SentryEnvelope,
  SentryEvent,
  SentryException,
  SentryFrame,
} from './drivers/sentry.js'
export { EARLY_ERROR_COLLECTOR, EARLY_ERROR_COLLECTOR_HASH } from './collector.js'
export { MonitoringError } from './errors.js'
export { createConsoleDriver } from './drivers/console.js'
export {
  createSentryDriver,
  parseSentryEnvelope,
  toSentryEnvelope,
  toSentryEvent,
} from './drivers/sentry.js'
export { createHealthHandler } from './health.js'
export { heartbeat } from './heartbeat.js'
export { parseStack } from './stack.js'

/**
 * Create an error reporter for a server: a fetch handler, a scheduled handler, a Durable Object,
 * a Node process. It turns what was caught into a report and hands that to a driver, which knows
 * the server the reports go to.
 *
 * Usage (a SvelteKit `hooks.server.ts`):
 *   const reporter = createErrorReporter({
 *     driver: createSentryDriver({ dsn: env.ERROR_DSN }),
 *     environment: 'production',
 *     release: version,
 *   })
 *
 *   export const handleError = ({ kind, error, event }) => {
 *     if (kind !== 'unknown') return // a 404, or an error the app threw on purpose
 *     const reference = reporter.report(error, {
 *       route: event.route.id,
 *       method: event.request.method,
 *       handled: false,
 *       waitUntil: event.platform?.ctx,
 *     })
 *     return { reference }
 *   }
 *
 * `report()` answers the reference at once and never throws; the delivery runs behind it, ends
 * after `timeout`, and what it fails with goes to `onError`. A report names no person: it has the
 * route pattern you pass and no address, no user, no cookie and no body. The module imports no
 * other module and needs nothing but `fetch`, so it runs in workerd and on Node alike.
 */
export function createErrorReporter(config: ErrorReporterConfig): ErrorReporterInstance {
  const { report, flush } = createReporter(config, { runtime: 'server' })
  return { report, flush }
}
