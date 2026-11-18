import { MonitoringError } from '../errors.js'
import { newReference } from '../reporter.js'
import { parseStack } from '../stack.js'
import type {
  Breadcrumb,
  ErrorCause,
  ErrorReport,
  ErrorReportDriver,
  SentryDriverConfig,
  StackFrame,
} from '../types.js'

/** How the driver names itself to the server: in the envelope, the event and the request */
const SDK = { name: 'loewen-digital.fullstack', version: '1.0.0' }

const REDIRECT = new Set([301, 302, 303, 307, 308])
const MAX_TAG_VALUE = 200
/** A server that asks for more silence than an hour is taken to mean an hour */
const MAX_SILENCE_S = 3600
/** Browsers allow 64 KiB for all `keepalive` requests under way together; this leaves room */
const MAX_KEEPALIVE_BYTES = 60_000

export interface SentryFrame {
  filename?: string
  abs_path?: string
  function?: string
  lineno?: number
  colno?: number
  in_app: boolean
}

export interface SentryException {
  type: string
  value: string
  stacktrace?: { frames: SentryFrame[] }
  mechanism?: { type: string; handled: boolean }
}

export interface SentryBreadcrumb {
  type: string
  category: string
  timestamp: string
  level?: string
  message?: string
  data?: Record<string, string | number | null>
}

/** The event as the driver writes it into an envelope */
export interface SentryEvent {
  event_id: string
  timestamp: string
  platform: 'javascript'
  level: 'error'
  environment?: string
  release?: string
  /** The route pattern */
  transaction?: string
  tags: Record<string, string>
  /** Oldest first: the root cause, then what it caused, the reported error last */
  exception: { values: SentryException[] }
  breadcrumbs?: { values: SentryBreadcrumb[] }
  request?: { method?: string; headers?: Record<string, string> }
  debug_meta?: { images: { type: 'sourcemap'; code_file: string; debug_id: string }[] }
  sdk: { name: string; version: string }
}

export interface SentryEnvelope {
  header: Record<string, unknown>
  items: { header: Record<string, unknown>; payload: unknown }[]
}

interface Dsn {
  publicKey: string
  /** `<protocol>//<host><path>/api/<project id>/envelope/` */
  endpoint: string
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  )
}

/**
 * Reads a DSN, `<protocol>://<public key>@<host><path>/<project id>`. A server behind a proxy
 * that ends TLS shows its DSN with `http://`; a page served over https cannot send there, so from
 * such a page the address is taken as `https://`.
 */
export function parseSentryDsn(dsn: string): Dsn | null {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    return null
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const projectId = segments.pop()
  if (!/^https?:$/.test(url.protocol) || url.username === '' || projectId === undefined) {
    return null
  }
  const pageIsSecure = typeof location !== 'undefined' && location.protocol === 'https:'
  const protocol =
    url.protocol === 'http:' && pageIsSecure && !isLocalHost(url.hostname) ? 'https:' : url.protocol
  const path = segments.length > 0 ? `/${segments.join('/')}` : ''
  return {
    publicKey: url.username,
    endpoint: `${protocol}//${url.host}${path}/api/${projectId}/envelope/`,
  }
}

function toFrames(frames: StackFrame[]): SentryFrame[] {
  // The protocol wants the oldest call first; a report has the newest first.
  return frames
    .map((frame) => ({
      ...(frame.file === undefined ? {} : { filename: frame.file, abs_path: frame.file }),
      ...(frame.function === undefined ? {} : { function: frame.function }),
      ...(frame.line === undefined ? {} : { lineno: frame.line }),
      ...(frame.column === undefined ? {} : { colno: frame.column }),
      in_app: frame.file === undefined || !/\/node_modules\/|^node:/.test(frame.file),
    }))
    .reverse()
}

function toException(error: ErrorCause): SentryException {
  return {
    type: error.type,
    value: error.message,
    ...(error.frames.length > 0 ? { stacktrace: { frames: toFrames(error.frames) } } : {}),
  }
}

function toBreadcrumb(crumb: Breadcrumb): SentryBreadcrumb {
  switch (crumb.type) {
    case 'navigation':
      return {
        type: 'navigation',
        category: 'navigation',
        timestamp: crumb.timestamp,
        data: { from: crumb.from, to: crumb.to },
      }
    case 'http':
      return {
        type: 'http',
        category: 'fetch',
        timestamp: crumb.timestamp,
        level:
          crumb.status === null || crumb.status >= 500
            ? 'error'
            : crumb.status >= 400
              ? 'warning'
              : 'info',
        data: { method: crumb.method, url: crumb.target, status_code: crumb.status },
      }
    case 'click':
      return {
        type: 'default',
        category: 'ui.click',
        timestamp: crumb.timestamp,
        message: crumb.target,
      }
  }
}

const MECHANISM = {
  report: 'generic',
  error: 'onerror',
  unhandledrejection: 'onunhandledrejection',
}

function toTags(report: ErrorReport, eventId: string): Record<string, string> {
  const tags: Record<string, string> = {}
  const all = {
    ...report.tags,
    runtime: report.runtime,
    ...(report.method === undefined ? {} : { method: report.method }),
    // The event id is the reference where it can be; an id of the app's own goes along as a tag.
    ...(report.reference === eventId ? {} : { reference: report.reference }),
  }
  for (const [key, value] of Object.entries(all)) {
    if (!/^[\w.:-]{1,32}$/.test(key)) continue
    tags[key] = String(value).replace(/\s+/g, ' ').slice(0, MAX_TAG_VALUE)
  }
  return tags
}

/**
 * The debug ids of the scripts that are loaded. The inject step of the source map tooling
 * (`sentry-cli sourcemaps inject`, `glitchtip-cli sourcemaps inject`, the bundler plugins) writes
 * a line into each script that puts its id into `_sentryDebugIds`, under the stack of that very
 * line. The file on top of that stack is the script.
 */
function createDebugIds(): (
  files: Set<string>,
) => NonNullable<SentryEvent['debug_meta']>['images'] {
  const fileOf = new Map<string, string | undefined>()
  return (files) => {
    const ids = (globalThis as { _sentryDebugIds?: Record<string, string> })._sentryDebugIds
    if (typeof ids !== 'object' || ids === null) return []
    const images: NonNullable<SentryEvent['debug_meta']>['images'] = []
    for (const [stack, id] of Object.entries(ids)) {
      if (!fileOf.has(stack)) fileOf.set(stack, parseStack(stack).find((frame) => frame.file)?.file)
      const file = fileOf.get(stack)
      if (file !== undefined && files.has(file) && typeof id === 'string') {
        images.push({ type: 'sourcemap', code_file: file, debug_id: id })
      }
    }
    return images
  }
}

/** The report in the shape of the Sentry protocol. Exported for tests of a driver of your own */
export function toSentryEvent(
  report: ErrorReport,
  debugImages: (files: Set<string>) => NonNullable<SentryEvent['debug_meta']>['images'] = () => [],
): SentryEvent {
  const eventId = /^[0-9a-f]{32}$/.test(report.reference) ? report.reference : newReference()
  const reported: SentryException = {
    ...toException(report),
    mechanism: { type: MECHANISM[report.source], handled: report.handled },
  }
  const files = new Set<string>()
  for (const error of [report, ...report.causes]) {
    for (const frame of error.frames) if (frame.file !== undefined) files.add(frame.file)
  }
  const images = debugImages(files)
  return {
    event_id: eventId,
    timestamp: report.timestamp,
    platform: 'javascript',
    level: 'error',
    ...(report.environment === undefined ? {} : { environment: report.environment }),
    ...(report.release === undefined ? {} : { release: report.release }),
    ...(report.route === null ? {} : { transaction: report.route }),
    tags: toTags(report, eventId),
    exception: { values: [...report.causes.map(toException).reverse(), reported] },
    ...(report.breadcrumbs.length > 0
      ? { breadcrumbs: { values: report.breadcrumbs.map(toBreadcrumb) } }
      : {}),
    ...(report.method === undefined && report.userAgent === undefined
      ? {}
      : {
          request: {
            ...(report.method === undefined ? {} : { method: report.method }),
            ...(report.userAgent === undefined
              ? {}
              : { headers: { 'User-Agent': report.userAgent } }),
          },
        }),
    ...(images.length > 0 ? { debug_meta: { images } } : {}),
    sdk: SDK,
  }
}

/** One event as an envelope: a header line, the item's header line, the event */
export function toSentryEnvelope(event: SentryEvent, sentAt: string): string {
  const payload = JSON.stringify(event)
  const length = new TextEncoder().encode(payload).length
  return `${JSON.stringify({ event_id: event.event_id, sent_at: sentAt, sdk: event.sdk })}\n${JSON.stringify(
    { type: 'event', length, content_type: 'application/json' },
  )}\n${payload}\n`
}

/** Reads an envelope back, as a server does: for a fake server and for tests */
export function parseSentryEnvelope(body: string): SentryEnvelope {
  const bytes = new TextEncoder().encode(body)
  const decoder = new TextDecoder()
  let position = 0
  const readLine = (): Uint8Array => {
    const end = bytes.indexOf(10, position)
    const line = bytes.subarray(position, end === -1 ? bytes.length : end)
    position = end === -1 ? bytes.length : end + 1
    return line
  }
  const json = (part: Uint8Array): unknown => JSON.parse(decoder.decode(part))

  const envelope: SentryEnvelope = {
    header: json(readLine()) as Record<string, unknown>,
    items: [],
  }
  while (position < bytes.length) {
    const headerLine = readLine()
    if (headerLine.length === 0) continue
    const header = json(headerLine) as Record<string, unknown>
    let payload: Uint8Array
    if (typeof header.length === 'number') {
      payload = bytes.subarray(position, position + header.length)
      position += header.length + 1
    } else {
      payload = readLine()
    }
    const text = decoder.decode(payload)
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // An attachment is no JSON; it stays the text it is.
    }
    envelope.items.push({ header, payload: parsed })
  }
  return envelope
}

/** For how many seconds the server wants no reports: its rate limit header, else `Retry-After` */
function silenceOf(response: Response, now: number): number | null {
  for (const limit of (response.headers.get('X-Sentry-Rate-Limits') ?? '').split(',')) {
    const [seconds, categories = ''] = limit.trim().split(':')
    const applies = categories === '' || categories.split(';').includes('error')
    const value = Number(seconds)
    if (applies && Number.isFinite(value) && value > 0) return Math.min(value, MAX_SILENCE_S)
  }
  const retry = response.headers.get('Retry-After')
  if (retry !== null) {
    const seconds = Number(retry)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, MAX_SILENCE_S)
    const date = Date.parse(retry)
    if (!Number.isNaN(date) && date > now) {
      return Math.min(Math.ceil((date - now) / 1000), MAX_SILENCE_S)
    }
  }
  return response.status === 429 ? 60 : null
}

/**
 * Create the driver for a server that speaks the Sentry protocol: Sentry, GlitchTip, Bugsink. It
 * turns a report into an event, wraps it in an envelope and posts that to the address in the DSN,
 * with `fetch` alone.
 *
 * Usage:
 *   const reporter = createErrorReporter({
 *     driver: createSentryDriver({ dsn: env.ERROR_DSN }),
 *     environment: 'production',
 *   })
 *
 * Without a DSN it answers `undefined`: the reporter then sends nothing, so the same code runs
 * where no server is set up. A DSN that cannot be read gives a driver whose every delivery fails
 * with that reason, told to the reporter's `onError`, and never an app that does not start.
 *
 * A DSN is public by design, it is in the source of every page that reports. When the server
 * answers 429 the driver sends nothing for as long as the server asks.
 */
export function createSentryDriver(config: SentryDriverConfig): ErrorReportDriver | undefined {
  if (config.dsn === undefined || config.dsn.trim() === '') return undefined
  const dsn = parseSentryDsn(config.dsn.trim())
  const debugImages = createDebugIds()
  let silentUntil = 0

  return {
    name: 'sentry',

    async send(report, context) {
      if (!dsn) {
        throw new MonitoringError(
          'monitoring: the DSN is not of the form https://<public key>@<host>/<project id>',
        )
      }
      const now = Date.now()
      if (now < silentUntil) return

      const send = config.fetch ?? context.fetch
      const body = toSentryEnvelope(toSentryEvent(report, debugImages), new Date(now).toISOString())
      const query = `?sentry_version=7&sentry_key=${encodeURIComponent(dsn.publicKey)}&sentry_client=${SDK.name}%2F${SDK.version}`
      // Text as the body makes the request a simple one: a browser sends it without a preflight.
      const init: RequestInit =
        report.runtime === 'browser'
          ? // `keepalive` lets the request outlive the page; a browser refuses it above 64 KiB.
            {
              method: 'POST',
              body,
              signal: context.signal,
              keepalive: new TextEncoder().encode(body).length <= MAX_KEEPALIVE_BYTES,
            }
          : // A redirect turns a POST into a GET without its body. On a server the driver reads
            // the redirect itself and posts once more to where it points, on the same host.
            { method: 'POST', body, signal: context.signal, redirect: 'manual' }

      let response = await send(dsn.endpoint + query, init)
      if (report.runtime === 'server' && REDIRECT.has(response.status)) {
        const target = response.headers.get('Location')
        const next = target === null ? null : new URL(target, dsn.endpoint)
        if (next !== null && next.hostname === new URL(dsn.endpoint).hostname) {
          void response.body?.cancel().catch(() => {})
          next.search = query
          response = await send(next.href, init)
        }
      }
      void response.body?.cancel().catch(() => {})

      const silence = silenceOf(response, now)
      if (silence !== null) silentUntil = now + silence * 1000
      if (response.status === 429) {
        throw new MonitoringError(
          `monitoring: the server takes no reports for the next ${silence ?? 60} seconds`,
        )
      }
      if (!response.ok) {
        throw new MonitoringError(`monitoring: the server answered ${response.status}`)
      }
    },
  }
}
