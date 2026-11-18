import { recordBreadcrumbs } from './breadcrumbs.js'
import type { BreadcrumbRecorder } from './breadcrumbs.js'
import type { EarlyErrors } from './collector.js'
import { isError } from './describe.js'
import { BOT_USER_AGENT, createNoiseFilter } from './noise.js'
import { createReporter, newReference } from './reporter.js'
import type { ErrorReport, ErrorReporterConfig, ErrorReporterInstance } from './types.js'

export type { EarlyErrors } from './collector.js'
export { EARLY_ERROR_COLLECTOR, EARLY_ERROR_COLLECTOR_HASH } from './collector.js'
export { describeElement } from './breadcrumbs.js'
export {
  BOT_USER_AGENT,
  IGNORED_MESSAGES,
  IGNORED_SCRIPTS,
  INJECTED_MESSAGES,
  createNoiseFilter,
} from './noise.js'
export type { NoiseOptions } from './noise.js'

export interface BrowserErrorReporterConfig extends ErrorReporterConfig {
  /**
   * The route pattern of the page the user is on, like `/items/[id]`: in SvelteKit
   * `() => page.route.id`. It stands in a report where the page's address would. Never answer
   * with the address itself.
   */
  route?: () => string | null | undefined
  /**
   * The route pattern a request of the page goes to, for its breadcrumb. Without an answer the
   * breadcrumb names the host and nothing of the path.
   */
  routeOf?: (url: URL) => string | null | undefined
  /** Messages to ignore, next to the built-in ones: a text that occurs in it, or a pattern */
  ignoreMessages?: readonly (string | RegExp)[]
  /** Scripts to ignore, next to the built-in ones, by the address of the newest frame */
  ignoreScripts?: readonly RegExp[]
  /** User agents that get no reporting, next to the built-in bots and headless browsers */
  ignoreUserAgents?: readonly RegExp[]
  /**
   * More origins the app's own scripts come from, like the one of a CDN. The page's own origin
   * counts, with and without `www.`; an error whose newest frame is from anywhere else is dropped.
   */
  origins?: readonly string[]
  /** How many breadcrumbs a report carries (default: 30); 0 records none and leaves `fetch` alone */
  maxBreadcrumbs?: number
}

export interface BrowserErrorReporterInstance extends ErrorReporterInstance {
  /** Takes the listeners off the page again and puts `fetch` back */
  stop(): void
}

/** `https://app.example` for `https://www.app.example` and the other way round */
function wwwTwin(origin: string): string {
  return origin.includes('://www.')
    ? origin.replace('://www.', '://')
    : origin.replace('://', '://www.')
}

/**
 * Create the error reporter of a page: it catches what nothing else caught (`error` and
 * `unhandledrejection`), takes over what the collector kept from before, drops what is no fault of
 * the app and hands the rest to the driver.
 *
 * Usage (a SvelteKit `hooks.client.ts`):
 *   const reporter = createBrowserErrorReporter({
 *     driver: createSentryDriver({ dsn: env.PUBLIC_ERROR_DSN }),
 *     environment: 'production',
 *     release: version,
 *     route: () => page.route.id,
 *   })
 *
 *   export const handleError = ({ kind, error }) => {
 *     if (kind !== 'unknown') return
 *     return { reference: reporter.report(error, { handled: false }) }
 *   }
 *
 * It starts with the call and is meant to be called once. Without a driver, for a bot and on a
 * server it does nothing: no listener, no wrapped `fetch`, no request.
 *
 * A report names no person. It has the route pattern and not the page's address, the browser's
 * user agent, and breadcrumbs of clicks (the element, never its text), requests (the route pattern
 * you name, else the host) and navigations (route patterns). No user, no cookie, no body, no query
 * string, no console output; nothing is sent but errors.
 */
export function createBrowserErrorReporter(
  config: BrowserErrorReporterConfig,
): BrowserErrorReporterInstance {
  const win = typeof window === 'undefined' ? undefined : window
  const userAgent = win?.navigator?.userAgent ?? ''
  const isBot = [BOT_USER_AGENT, ...(config.ignoreUserAgents ?? [])].some((pattern) =>
    new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(userAgent),
  )
  if (!win || !config.driver || isBot) {
    return { report: () => newReference(), flush: async () => {}, stop() {} }
  }

  const origin = win.location.origin
  const origins = [origin, wwwTwin(origin), ...(config.origins ?? [])]
  const firstPath = win.location.pathname
  const maxBreadcrumbs = config.maxBreadcrumbs ?? 30

  function route(): string | null {
    try {
      const pattern = config.route?.()
      return typeof pattern === 'string' && pattern !== '' ? pattern : null
    } catch {
      return null
    }
  }

  const recorder: BreadcrumbRecorder | null =
    maxBreadcrumbs > 0
      ? recordBreadcrumbs(win, { max: maxBreadcrumbs, route, routeOf: config.routeOf })
      : null

  /**
   * A script in the page itself is named by the page's address, with the ids in its path. Such a
   * frame is renamed to `<origin>/[page]`; the route pattern says which page it was.
   */
  function withoutPages(file: string | undefined): string | undefined {
    if (file === undefined || !file.startsWith(`${origin}/`)) return file
    const path = file.slice(origin.length)
    return path === firstPath || path === win!.location.pathname ? `${origin}/[page]` : file
  }

  function complete(report: ErrorReport): void {
    report.route ??= route()
    report.userAgent = userAgent
    for (const error of [report, ...report.causes]) {
      for (const frame of error.frames) {
        const file = withoutPages(frame.file)
        if (file !== undefined) frame.file = file
      }
    }
    if (recorder) {
      recorder.noteRoute()
      report.breadcrumbs = recorder.crumbs()
    }
  }

  const reporter = createReporter(config, {
    runtime: 'browser',
    complete,
    isNoise: createNoiseFilter({
      origins,
      ignoreMessages: config.ignoreMessages,
      ignoreScripts: config.ignoreScripts,
    }),
    fetch: recorder ? recorder.fetch : (input, init) => win.fetch(input, init),
  })

  /** When an event happened: its own clock counts from the page's start */
  function timeOf(event: Event): number {
    const now = Date.now()
    const started = win!.performance?.timeOrigin
    const at = typeof started === 'number' ? started + event.timeStamp : NaN
    return at <= now && at > now - 3_600_000 ? at : now
  }

  function onError(event: Event): void {
    try {
      const { error, message, filename, lineno, colno } = event as ErrorEvent
      const options = { handled: false, source: 'error', at: timeOf(event) } as const
      if (isError(error)) reporter.capture(error, options)
      else if (typeof message === 'string' && message !== '') {
        // No error object: a script of another origin, or something thrown that is no error.
        // The event still says where.
        reporter.capture(
          {
            name: 'Error',
            message: message.replace(/^Uncaught /, ''),
            stack: filename ? `@${filename}:${lineno}:${colno}` : undefined,
          },
          options,
        )
      }
    } catch {
      // An error thrown here would arrive here again.
    }
  }

  function onRejection(event: Event): void {
    try {
      const { reason } = event as PromiseRejectionEvent
      // A rejection with something that is no error is a library's control flow, not a fault.
      if (isError(reason)) {
        reporter.capture(reason, {
          handled: false,
          source: 'unhandledrejection',
          at: timeOf(event),
        })
      }
    } catch {
      // See onError().
    }
  }

  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)

  // What the collector kept from before this code was loaded. Our listeners are on, so it can go.
  const early = (win as { __earlyErrors?: Partial<EarlyErrors> }).__earlyErrors
  try {
    early?.stop?.()
    for (const event of Array.isArray(early?.events) ? early.events.splice(0) : []) {
      if (event.type === 'unhandledrejection') onRejection(event)
      else onError(event)
    }
  } catch {
    // A collector that is not ours, or broken: the reporting runs without what it had.
  }

  return {
    report: (error, options) => reporter.capture(error, options),
    flush: () => reporter.flush(),
    stop() {
      win.removeEventListener('error', onError)
      win.removeEventListener('unhandledrejection', onRejection)
      recorder?.stop()
    },
  }
}
