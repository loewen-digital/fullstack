import { afterEach, describe, it, expect, vi } from 'vite-plus/test'
import {
  createErrorReporter,
  createSentryDriver,
  parseSentryEnvelope,
  toSentryEnvelope,
  toSentryEvent,
} from '../index.js'
import type { ErrorReport, MonitoringFetch } from '../index.js'
import { createFakeSentryServer } from '../../testing/index.js'

const report: ErrorReport = {
  reference: '0123456789abcdef0123456789abcdef',
  timestamp: '2026-11-18T10:00:00.000Z',
  type: 'TypeError',
  message: 'no items',
  frames: [
    { file: 'https://app.example/_app/item.js', function: 'render', line: 12, column: 34 },
    { file: 'https://app.example/node_modules/lib/index.js', function: 'each', line: 2 },
    { function: 'Array.map' },
  ],
  causes: [
    { type: 'Error', message: 'could not load', frames: [] },
    { type: 'RangeError', message: 'disk full', frames: [{ file: 'node:fs', line: 1 }] },
  ],
  handled: false,
  source: 'unhandledrejection',
  runtime: 'browser',
  environment: 'production',
  release: '1.4.0',
  route: '/items/[id]',
  userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15',
  breadcrumbs: [
    { type: 'navigation', timestamp: '2026-11-18T09:59:50.000Z', from: '/', to: '/items/[id]' },
    {
      type: 'http',
      timestamp: '2026-11-18T09:59:51.000Z',
      method: 'GET',
      target: '/api/items/[id]',
      status: 500,
    },
    { type: 'click', timestamp: '2026-11-18T09:59:52.000Z', target: 'button#save.primary' },
  ],
  tags: { app: 'notes' },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (globalThis as { _sentryDebugIds?: unknown })._sentryDebugIds
})

describe('createSentryDriver', () => {
  it('posts a report as an envelope to the address the DSN names', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const server = createFakeSentryServer({ dsn: 'https://abc123@errors.example/7' })
    const reporter = createErrorReporter({
      driver: createSentryDriver({
        dsn: server.dsn,
        fetch(input, init) {
          requests.push({ url: input, init })
          return server.fetch(input, init)
        },
      }),
      environment: 'production',
      release: '1.4.0',
    })

    const reference = reporter.report(new TypeError('no items'), {
      route: '/items/[id]',
      method: 'GET',
      handled: false,
    })
    await reporter.flush()

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'https://errors.example/api/7/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=loewen-digital.fullstack%2F1.0.0',
    )
    expect(requests[0]?.init?.method).toBe('POST')
    // No header of its own: with one, a browser would ask the server for permission first.
    expect(requests[0]?.init?.headers).toBeUndefined()

    const event = server.events[0]!
    expect(event).toMatchObject({
      event_id: reference,
      platform: 'javascript',
      level: 'error',
      environment: 'production',
      release: '1.4.0',
      transaction: '/items/[id]',
      tags: { runtime: 'server', method: 'GET' },
      request: { method: 'GET' },
      sdk: { name: 'loewen-digital.fullstack', version: '1.0.0' },
    })
    const [exception] = event.exception.values
    expect(exception).toMatchObject({
      type: 'TypeError',
      value: 'no items',
      mechanism: { type: 'generic', handled: false },
    })
    // Oldest call first: the test itself is the newest and stands last.
    expect(exception?.stacktrace?.frames.at(-1)?.filename).toContain('sentry.test')
    expect(event.breadcrumbs).toBeUndefined()
    expect(event.debug_meta).toBeUndefined()
  })

  it('answers no driver without a DSN, so the reporter sends nothing', () => {
    expect(createSentryDriver({ dsn: undefined })).toBeUndefined()
    expect(createSentryDriver({ dsn: '' })).toBeUndefined()
    expect(createSentryDriver({ dsn: '   ' })).toBeUndefined()
  })

  it('keeps the path a DSN has in front of the project id', async () => {
    const urls: string[] = []
    const reporter = createErrorReporter({
      driver: createSentryDriver({
        dsn: 'https://abc123@errors.example/glitchtip/7',
        async fetch(input) {
          urls.push(input)
          return new Response('{}')
        },
      }),
    })

    reporter.report(new Error('boom'))
    await reporter.flush()

    expect(urls[0]).toMatch(/^https:\/\/errors\.example\/glitchtip\/api\/7\/envelope\/\?/)
  })

  it.each(['not a dsn', 'https://errors.example/7', 'ftp://abc123@errors.example/7'])(
    'fails every delivery for the DSN %j instead of failing the app',
    async (dsn) => {
      const send = vi.fn<MonitoringFetch>()
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: createSentryDriver({ dsn, fetch: send }),
        onError,
      })

      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(send).not.toHaveBeenCalled()
      expect((onError.mock.calls[0]![0] as Error).message).toBe(
        'monitoring: the DSN is not of the form https://<public key>@<host>/<project id>',
      )
    },
  )

  it('sends the app’s own reference along as a tag', async () => {
    const server = createFakeSentryServer()
    const reporter = createErrorReporter({
      driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
    })

    reporter.report(new Error('boom'), { reference: '8a1b2c3d4e5f-FRA' })
    await reporter.flush()

    expect(server.events[0]?.event_id).toMatch(/^[0-9a-f]{32}$/)
    expect(server.events[0]?.tags.reference).toBe('8a1b2c3d4e5f-FRA')
  })

  describe('the address', () => {
    async function addressFor(dsn: string): Promise<string> {
      const urls: string[] = []
      const reporter = createErrorReporter({
        driver: createSentryDriver({
          dsn,
          async fetch(input) {
            urls.push(input)
            return new Response('{}')
          },
        }),
      })
      reporter.report(new Error('boom'))
      await reporter.flush()
      return urls[0]!
    }

    it('sends to https from an https page although the DSN says http', async () => {
      vi.stubGlobal('location', { protocol: 'https:' })

      expect(await addressFor('http://abc123@errors.example/7')).toMatch(
        /^https:\/\/errors\.example\/api\/7\/envelope\//,
      )
    })

    it('leaves http alone on an http page and for a server on this machine', async () => {
      vi.stubGlobal('location', { protocol: 'http:' })
      expect(await addressFor('http://abc123@errors.example/7')).toMatch(/^http:\/\/errors\./)

      vi.stubGlobal('location', { protocol: 'https:' })
      expect(await addressFor('http://abc123@localhost:8000/7')).toMatch(/^http:\/\/localhost:8000/)
      expect(await addressFor('http://abc123@127.0.0.1:8000/7')).toMatch(/^http:\/\/127\.0\.0\.1/)
    })

    it('posts again where a server-side redirect points, with the envelope', async () => {
      const server = createFakeSentryServer({ dsn: 'http://abc123@errors.example/7' })
      const requests: { url: string; redirect: RequestRedirect | undefined }[] = []
      const reporter = createErrorReporter({
        driver: createSentryDriver({
          dsn: server.dsn,
          async fetch(input, init) {
            requests.push({ url: input, redirect: init?.redirect })
            if (input.startsWith('http://')) {
              // The proxy in front of the server, which only speaks https.
              return new Response(null, {
                status: 301,
                headers: { Location: 'https://errors.example/api/7/envelope/' },
              })
            }
            return server.fetch(input, init)
          },
        }),
      })

      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(requests.map((request) => request.url.split('?')[0])).toEqual([
        'http://errors.example/api/7/envelope/',
        'https://errors.example/api/7/envelope/',
      ])
      expect(requests.every((request) => request.redirect === 'manual')).toBe(true)
      expect(server.events).toHaveLength(1)
      expect(server.events[0]?.exception.values[0]?.value).toBe('boom')
    })

    it('does not follow a redirect to another host', async () => {
      const urls: string[] = []
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: createSentryDriver({
          dsn: 'https://abc123@errors.example/7',
          async fetch(input) {
            urls.push(input)
            return new Response(null, {
              status: 302,
              headers: { Location: 'https://elsewhere.example/collect' },
            })
          },
        }),
        onError,
      })

      reporter.report(new Error('boom'))
      await reporter.flush()

      expect(urls).toHaveLength(1)
      expect((onError.mock.calls[0]![0] as Error).message).toBe(
        'monitoring: the server answered 302',
      )
    })
  })

  describe('what the server answers', () => {
    it('tells onError the status of a refusal, and nothing of the DSN', async () => {
      const server = createFakeSentryServer({ dsn: 'https://abc123@errors.example/7' })
      server.answer(503)
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
        onError,
      })

      reporter.report(new Error('boom'))
      await reporter.flush()

      const message = (onError.mock.calls[0]![0] as Error).message
      expect(message).toBe('monitoring: the server answered 503')
      expect(message).not.toContain('abc123')
    })

    it('sends nothing for as long as a 429 asks', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
      const server = createFakeSentryServer()
      const send = vi.fn(server.fetch)
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: createSentryDriver({ dsn: server.dsn, fetch: send }),
        onError,
      })

      server.answer(429, { 'Retry-After': '120' })
      reporter.report(new Error('1'))
      await reporter.flush()
      server.clear()

      vi.setSystemTime(new Date('2026-11-18T10:01:59Z'))
      reporter.report(new Error('2'))
      await reporter.flush()
      expect(send).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledTimes(1)
      expect((onError.mock.calls[0]![0] as Error).message).toBe(
        'monitoring: the server takes no reports for the next 120 seconds',
      )

      vi.setSystemTime(new Date('2026-11-18T10:02:01Z'))
      reporter.report(new Error('3'))
      await reporter.flush()
      expect(send).toHaveBeenCalledTimes(2)
      expect(server.events.map((event) => event.exception.values[0]?.value)).toEqual(['3'])
    })

    it('reads the rate limit header for errors, and one minute when a 429 names no time', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
      const server = createFakeSentryServer()
      const onError = vi.fn()
      const reporter = createErrorReporter({
        driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
        onError,
      })

      server.answer(429, { 'X-Sentry-Rate-Limits': '600:transaction:key, 30:error;default:key' })
      reporter.report(new Error('1'))
      await reporter.flush()
      expect((onError.mock.calls[0]![0] as Error).message).toContain('next 30 seconds')

      vi.setSystemTime(new Date('2026-11-18T10:00:31Z'))
      server.answer(429)
      reporter.report(new Error('2'))
      await reporter.flush()
      expect((onError.mock.calls[1]![0] as Error).message).toContain('next 60 seconds')
    })
  })

  it('names the debug id of each script the stack runs through', async () => {
    const server = createFakeSentryServer()
    const reporter = createErrorReporter({
      driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
    })
    const error = new Error('boom')
    error.stack = [
      'Error: boom',
      '    at render (https://app.example/_app/item.js?v=3:12:34)',
      '    at start (https://app.example/_app/start.js:1:9)',
    ].join('\n')
    // What the inject step of the source map tooling leaves behind, one entry per script.
    ;(globalThis as { _sentryDebugIds?: Record<string, string> })._sentryDebugIds = {
      'Error\n    at https://app.example/_app/item.js:1:42': '395835f4-03e0-4436-80d3-136f0749a893',
      '@https://app.example/_app/other.js:1:42': 'aaaaaaaa-03e0-4436-80d3-136f0749a893',
    }

    reporter.report(error)
    await reporter.flush()

    expect(server.events[0]?.debug_meta).toEqual({
      images: [
        {
          type: 'sourcemap',
          code_file: 'https://app.example/_app/item.js',
          debug_id: '395835f4-03e0-4436-80d3-136f0749a893',
        },
      ],
    })
    expect(server.events[0]?.exception.values[0]?.stacktrace?.frames.at(-1)?.abs_path).toBe(
      'https://app.example/_app/item.js',
    )
  })
})

describe('a report from a page', () => {
  async function initFor(sent: ErrorReport): Promise<RequestInit | undefined> {
    let init: RequestInit | undefined
    const driver = createSentryDriver({
      dsn: 'https://abc123@errors.example/7',
      async fetch(_input, given) {
        init = given
        return new Response('{}')
      },
    })
    await driver?.send(sent, { fetch: globalThis.fetch, signal: new AbortController().signal })
    return init
  }

  it('is sent so that it outlives the page, and follows redirects as the browser does', async () => {
    const init = await initFor(report)

    expect(init?.keepalive).toBe(true)
    expect(init?.redirect).toBeUndefined()
  })

  it('goes without keepalive when it is larger than a browser allows for that', async () => {
    const long = `https://app.example/_app/${'x'.repeat(1500)}.js`
    const init = await initFor({
      ...report,
      frames: Array.from({ length: 50 }, (_unused, line) => ({ file: long, line })),
    })

    expect(init?.keepalive).toBe(false)
  })
})

describe('toSentryEvent', () => {
  it('writes the chain of causes oldest first and the reported error last', () => {
    const event = toSentryEvent(report)

    expect(event.exception.values.map((value) => `${value.type}: ${value.value}`)).toEqual([
      'RangeError: disk full',
      'Error: could not load',
      'TypeError: no items',
    ])
    expect(event.exception.values[2]?.mechanism).toEqual({
      type: 'onunhandledrejection',
      handled: false,
    })
    expect(event.exception.values[0]?.mechanism).toBeUndefined()
    expect(event.exception.values[1]?.stacktrace).toBeUndefined()
  })

  it('turns the frames around and marks what is not the app’s code', () => {
    const frames = toSentryEvent(report).exception.values[2]?.stacktrace?.frames

    expect(frames).toEqual([
      { function: 'Array.map', in_app: true },
      {
        filename: 'https://app.example/node_modules/lib/index.js',
        abs_path: 'https://app.example/node_modules/lib/index.js',
        function: 'each',
        lineno: 2,
        in_app: false,
      },
      {
        filename: 'https://app.example/_app/item.js',
        abs_path: 'https://app.example/_app/item.js',
        function: 'render',
        lineno: 12,
        colno: 34,
        in_app: true,
      },
    ])
  })

  it('carries the breadcrumbs, the browser and the route, and no address', () => {
    const event = toSentryEvent(report)

    expect(event.transaction).toBe('/items/[id]')
    expect(event.request).toEqual({
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' },
    })
    expect(event.breadcrumbs?.values).toEqual([
      {
        type: 'navigation',
        category: 'navigation',
        timestamp: '2026-11-18T09:59:50.000Z',
        data: { from: '/', to: '/items/[id]' },
      },
      {
        type: 'http',
        category: 'fetch',
        timestamp: '2026-11-18T09:59:51.000Z',
        level: 'error',
        data: { method: 'GET', url: '/api/items/[id]', status_code: 500 },
      },
      {
        type: 'default',
        category: 'ui.click',
        timestamp: '2026-11-18T09:59:52.000Z',
        message: 'button#save.primary',
      },
    ])
    expect(event).not.toHaveProperty('user')
  })

  it('keeps tags to what the protocol takes', () => {
    const event = toSentryEvent({
      ...report,
      tags: { ok: 'yes', 'a key with spaces': 'dropped', long: `two\nlines ${'x'.repeat(300)}` },
    })

    expect(event.tags.ok).toBe('yes')
    expect(event.tags).not.toHaveProperty('a key with spaces')
    expect(event.tags.long).toHaveLength(200)
    expect(event.tags.long).not.toContain('\n')
    expect(event.tags.runtime).toBe('browser')
  })
})

describe('the envelope', () => {
  it('declares the length of the event in bytes and reads back as it was written', () => {
    const event = toSentryEvent({ ...report, message: 'Größe überschritten ✗' })

    const text = toSentryEnvelope(event, '2026-11-18T10:00:01.000Z')
    const envelope = parseSentryEnvelope(text)

    expect(envelope.header).toEqual({
      event_id: report.reference,
      sent_at: '2026-11-18T10:00:01.000Z',
      sdk: { name: 'loewen-digital.fullstack', version: '1.0.0' },
    })
    expect(envelope.items).toHaveLength(1)
    expect(envelope.items[0]?.header).toEqual({
      type: 'event',
      length: new TextEncoder().encode(JSON.stringify(event)).length,
      content_type: 'application/json',
    })
    expect(envelope.items[0]?.payload).toEqual(event)
  })

  it('reads an envelope with several items, with and without a length', () => {
    const envelope = parseSentryEnvelope(
      [
        '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}',
        '{"type":"attachment","length":10,"content_type":"text/plain"}',
        'hello\nworl',
        '{"type":"event"}',
        '{"message":"hello world","level":"error"}',
        '',
      ].join('\n'),
    )

    expect(envelope.items).toEqual([
      {
        header: { type: 'attachment', length: 10, content_type: 'text/plain' },
        payload: 'hello\nworl',
      },
      { header: { type: 'event' }, payload: { message: 'hello world', level: 'error' } },
    ])
  })
})
