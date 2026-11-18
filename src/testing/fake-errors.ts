/**
 * Fakes for the monitoring module.
 *
 * `createFakeErrorDriver()` takes the place of the driver and keeps each report as the reporter
 * built it, whatever server the app reports to in production:
 *
 *   const fakeErrors = createFakeErrorDriver()
 *   const reporter = createErrorReporter({ driver: fakeErrors })
 *
 *   reporter.report(new TypeError('no items'), { route: '/items/[id]', method: 'GET' })
 *   await reporter.flush()
 *   expect(fakeErrors.last()?.route).toBe('/items/[id]')
 *
 * `createFakeSentryServer()` stands where the server is and catches what the Sentry driver would
 * send over the network: for a test of the whole path, and for a browser test that routes the
 * page's requests to `handle()`.
 *
 *   const server = createFakeSentryServer()
 *   const reporter = createErrorReporter({
 *     driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
 *   })
 *
 *   reporter.report(new Error('boom'))
 *   await reporter.flush()
 *   expect(server.events[0]?.exception.values.at(-1)?.value).toBe('boom')
 */

import { parseSentryEnvelope } from '../monitoring/index.js'
import type {
  ErrorReport,
  ErrorReportDriver,
  MonitoringFetch,
  SentryEvent,
} from '../monitoring/index.js'

export interface FakeErrorDriver extends ErrorReportDriver {
  /** Every report that was handed over since creation or the last clear() */
  readonly reports: ErrorReport[]
  /** The newest report */
  last(): ErrorReport | undefined
  /** From now on a delivery fails, as a server that is down makes it */
  fail(reason?: string): void
  /** Forget the reports, and deliver again */
  clear(): void
}

export function createFakeErrorDriver(): FakeErrorDriver {
  const reports: ErrorReport[] = []
  let failure: string | null = null

  return {
    name: 'fake',
    reports,

    async send(report) {
      if (failure !== null) throw new Error(failure)
      reports.push(report)
    },

    last() {
      return reports.at(-1)
    },

    fail(reason = 'the fake error server is down') {
      failure = reason
    },

    clear() {
      reports.length = 0
      failure = null
    },
  }
}

export interface FakeSentryServerOptions {
  /** The DSN the server answers to (default: `https://public@errors.test/1`) */
  dsn?: string
}

export interface FakeSentryServer {
  /** The DSN to configure the driver with */
  readonly dsn: string
  /** Every event that arrived since creation or the last clear() */
  readonly events: SentryEvent[]
  /** A `fetch` that ends here, for the driver's `fetch` option */
  readonly fetch: MonitoringFetch
  /**
   * Takes a request as the real server does: the envelope POST and its preflight, answered with
   * `Access-Control-Allow-Origin`, without which a browser drops the request.
   */
  handle(request: Request): Promise<Response>
  /** From now on every POST is answered with this status, like 429 or 503 */
  answer(status: number, headers?: Record<string, string>): void
  /** Forget the events, and answer 200 again */
  clear(): void
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sentry-Auth',
}

export function createFakeSentryServer(options: FakeSentryServerOptions = {}): FakeSentryServer {
  const dsn = options.dsn ?? 'https://public@errors.test/1'
  const address = new URL(dsn)
  const projectId = address.pathname.split('/').filter(Boolean).at(-1) ?? ''
  const events: SentryEvent[] = []
  let forced: { status: number; headers: Record<string, string> } | null = null

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS, ...headers },
    })

  async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(request.url)
    if (request.method !== 'POST' || !url.pathname.endsWith(`/api/${projectId}/envelope/`)) {
      return reply(404, { detail: 'not found' })
    }
    const key =
      url.searchParams.get('sentry_key') ??
      /sentry_key=([^,\s]+)/.exec(request.headers.get('X-Sentry-Auth') ?? '')?.[1]
    if (key !== address.username) return reply(403, { detail: 'unknown key' })
    if (forced) return reply(forced.status, { detail: 'forced' }, forced.headers)

    let id: unknown
    try {
      const envelope = parseSentryEnvelope(await request.text())
      id = envelope.header.event_id
      for (const item of envelope.items) {
        if (item.header.type === 'event') events.push(item.payload as SentryEvent)
      }
    } catch {
      return reply(400, { detail: 'no envelope' })
    }
    return reply(200, { id })
  }

  return {
    dsn,
    events,
    handle,

    fetch: (input, init) => handle(new Request(input, init)),

    answer(status, headers = {}) {
      forced = { status, headers }
    },

    clear() {
      events.length = 0
      forced = null
    },
  }
}
