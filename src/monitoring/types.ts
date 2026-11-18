/** One call of a stack, as the engine wrote it down */
export interface StackFrame {
  /** The script: its address without query string and fragment, or its path on a server */
  file?: string
  function?: string
  /** Starting at 1 */
  line?: number
  /** Starting at 1 */
  column?: number
}

/** An error another one names as its `cause` */
export interface ErrorCause {
  type: string
  message: string
  /** Newest call first */
  frames: StackFrame[]
}

/** What happened before an error, in the browser. None of them carries an address */
export type Breadcrumb =
  | {
      type: 'navigation'
      timestamp: string
      /** Route patterns, like `/items/[id]` */
      from: string | null
      to: string | null
    }
  | {
      type: 'http'
      timestamp: string
      method: string
      /** The route pattern the app named for the request, or the host it went to */
      target: string
      /** `null` when no answer came */
      status: number | null
    }
  | {
      type: 'click'
      timestamp: string
      /** The element by tag, id, classes and `name`, never by its text */
      target: string
    }

/** Where a report was made */
export type ErrorRuntime = 'browser' | 'server'

/** How an error reached the reporter: handed over by the app, or caught from the page */
export type ErrorSource = 'report' | 'error' | 'unhandledrejection'

/**
 * An error as a driver gets it: complete, and free of everything that says who. There is no
 * address in it, only the app's route pattern; no user, no cookie, no body, no query string.
 */
export interface ErrorReport {
  /** The id of this report: 32 hex characters, or what the app passed as `reference` */
  reference: string
  /** ISO timestamp of the moment the error was caught */
  timestamp: string
  /** The error's name, like `TypeError` */
  type: string
  message: string
  /** The stack, newest call first; empty when the engine gave none */
  frames: StackFrame[]
  /** The chain of `cause`, nearest first */
  causes: ErrorCause[]
  /** `false` for an error nothing caught */
  handled: boolean
  source: ErrorSource
  runtime: ErrorRuntime
  environment?: string
  release?: string
  /** The route pattern, like `/items/[id]`; `null` when the app named none */
  route: string | null
  /** The HTTP method of the request that failed, on a server */
  method?: string
  /** The browser, by its user agent; never set on a server */
  userAgent?: string
  /** Oldest first; empty on a server */
  breadcrumbs: Breadcrumb[]
  tags: Record<string, string>
}

/** The `fetch` a driver sends with */
export type MonitoringFetch = (input: string, init?: RequestInit) => Promise<Response>

/** What a driver gets next to the report */
export interface ErrorReportContext {
  /** Send with this one: in the browser it is the `fetch` that leaves no breadcrumb */
  fetch: MonitoringFetch
  /** Aborts when the reporter gives up on the delivery */
  signal: AbortSignal
}

/**
 * Where reports go. A driver knows a server's format and address and nothing else: it gets the
 * finished report and sends it. Resolve when the report was taken or deliberately dropped, reject
 * when it was lost.
 */
export interface ErrorReportDriver {
  /** For logs */
  readonly name: string
  send(report: ErrorReport, context: ErrorReportContext): Promise<void>
}

/** A function that keeps the runtime alive for a promise, or the object that has it (`ctx`) */
export type WaitUntil =
  | ((promise: Promise<unknown>) => void)
  | { waitUntil(promise: Promise<unknown>): void }

export interface ErrorReporterConfig {
  /** Where reports go. Without one nothing is built and nothing is sent */
  driver: ErrorReportDriver | undefined
  /** Like `production` or `staging` */
  environment?: string
  /** The version that runs, as the source maps of the deploy name it */
  release?: string
  /** Tags on every report */
  tags?: Record<string, string>
  /** Sees the finished report; `false` drops it */
  filter?: (report: ErrorReport) => boolean
  /** Reports within a minute before the rest is dropped (default: 30) */
  maxPerMinute?: number
  /** Milliseconds after which a delivery is given up (default: 5000) */
  timeout?: number
  /** Called with what a delivery failed with (default: `console.error`) */
  onError?: (error: unknown) => void
  /** The `fetch` handed to the driver (default: the global one) */
  fetch?: MonitoringFetch
}

export interface ReportOptions {
  /** The route pattern, like `/items/[id]`. Never the address of the request */
  route?: string | null
  /** The HTTP method of the request */
  method?: string
  /** An id of your own for this report (letters, digits, `.`, `_`, `:`, `-`; 64 at most) */
  reference?: string
  /** `false` for an error nothing caught (default: `true`) */
  handled?: boolean
  tags?: Record<string, string>
  /**
   * Keeps the runtime alive until the report is out: `ctx` or `(promise) => ctx.waitUntil(promise)`
   * on Cloudflare. Without it the delivery runs on its own, which a Worker cuts off with the
   * response.
   */
  waitUntil?: WaitUntil
}

export interface ErrorReporterInstance {
  /**
   * Reports an error and answers its reference at once; the delivery runs behind it. Never
   * throws, whatever is handed over and whatever the driver does.
   */
  report(error: unknown, options?: ReportOptions): string
  /** Resolves when every delivery under way has ended: before a script exits, and in tests */
  flush(): Promise<void>
}

export interface HeartbeatOptions {
  /** Milliseconds after which the ping is given up (default: 5000) */
  timeout?: number
  /** The HTTP method the monitor expects (default: `POST`) */
  method?: 'GET' | 'POST' | 'HEAD'
  /** The `fetch` to ping with (default: the global one) */
  fetch?: MonitoringFetch
}

/** One check of the health handler: it passes unless it throws, rejects or answers `false` */
export type HealthCheck = (signal: AbortSignal) => unknown

export interface HealthHandlerConfig {
  /** What has to work for the app to count as up, by a name for the log */
  checks?: Record<string, HealthCheck>
  /** Milliseconds a check may take (default: 3000) */
  timeout?: number
  /** Called for each check that failed (default: `console.error`). The response never says which */
  onFailure?: (name: string, error: unknown) => void
}

export type HealthHandler = (request: Request) => Promise<Response>

export interface SentryDriverConfig {
  /**
   * The DSN of the project: `https://<public key>@<host>/<project id>`. Without one
   * `createSentryDriver` answers `undefined`, and a reporter without a driver sends nothing.
   */
  dsn: string | undefined
  /** The `fetch` to send with (default: the one the reporter hands over) */
  fetch?: MonitoringFetch
}
