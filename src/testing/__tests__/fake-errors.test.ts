import { describe, it, expect, vi } from 'vite-plus/test'
import { createFakeErrorDriver, createFakeSentryServer } from '../index.js'
import { createErrorReporter, createSentryDriver } from '../../monitoring/index.js'

describe('FakeErrorDriver', () => {
  it('keeps each report and names the newest', async () => {
    const fakeErrors = createFakeErrorDriver()
    const reporter = createErrorReporter({ driver: fakeErrors })

    reporter.report(new Error('first'))
    reporter.report(new TypeError('second'), { route: '/items/[id]' })
    await reporter.flush()

    expect(fakeErrors.reports).toHaveLength(2)
    expect(fakeErrors.last()).toMatchObject({
      type: 'TypeError',
      message: 'second',
      route: '/items/[id]',
    })
  })

  it('fails deliveries when told to, and delivers again after clear()', async () => {
    const fakeErrors = createFakeErrorDriver()
    const onError = vi.fn()
    const reporter = createErrorReporter({ driver: fakeErrors, onError })

    fakeErrors.fail()
    reporter.report(new Error('lost'))
    await reporter.flush()
    expect(fakeErrors.reports).toHaveLength(0)
    expect((onError.mock.calls[0]![0] as Error).message).toBe('the fake error server is down')

    fakeErrors.clear()
    reporter.report(new Error('kept'))
    await reporter.flush()
    expect(fakeErrors.last()?.message).toBe('kept')
    expect(fakeErrors.last()).toBe(fakeErrors.reports[0])
  })
})

describe('FakeSentryServer', () => {
  const envelope = [
    '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc"}',
    '{"type":"event"}',
    '{"event_id":"9ec79c33ec9942ab8353589fcb2e04dc","level":"error"}',
  ].join('\n')

  const post = (url: string, headers: Record<string, string> = {}): Request =>
    new Request(url, { method: 'POST', body: envelope, headers })

  it('catches what the Sentry driver sends', async () => {
    const server = createFakeSentryServer()
    const reporter = createErrorReporter({
      driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
    })

    reporter.report(new Error('boom'))
    await reporter.flush()

    expect(server.dsn).toBe('https://public@errors.test/1')
    expect(server.events).toHaveLength(1)
    expect(server.events[0]?.exception.values.at(-1)?.value).toBe('boom')
  })

  it('answers the POST and its preflight so that a browser accepts the answer', async () => {
    const server = createFakeSentryServer()

    const preflight = await server.handle(
      new Request('https://errors.test/api/1/envelope/', { method: 'OPTIONS' }),
    )
    const response = await server.handle(
      post('https://errors.test/api/1/envelope/?sentry_version=7&sentry_key=public'),
    )

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ id: '9ec79c33ec9942ab8353589fcb2e04dc' })
    expect(server.events).toEqual([
      { event_id: '9ec79c33ec9942ab8353589fcb2e04dc', level: 'error' },
    ])
  })

  it('takes the key from the auth header as well', async () => {
    const server = createFakeSentryServer({ dsn: 'https://abc123@errors.example/glitchtip/7' })

    const response = await server.handle(
      post('https://errors.example/glitchtip/api/7/envelope/', {
        'X-Sentry-Auth': 'Sentry sentry_version=7, sentry_key=abc123, sentry_client=test/1',
      }),
    )

    expect(response.status).toBe(200)
    expect(server.events).toHaveLength(1)
  })

  it('refuses another key, another project and what is no envelope', async () => {
    const server = createFakeSentryServer()

    const wrongKey = await server.handle(
      post('https://errors.test/api/1/envelope/?sentry_key=someone-else'),
    )
    const wrongProject = await server.handle(
      post('https://errors.test/api/2/envelope/?sentry_key=public'),
    )
    const noEnvelope = await server.handle(
      new Request('https://errors.test/api/1/envelope/?sentry_key=public', {
        method: 'POST',
        body: 'not json',
      }),
    )

    expect(wrongKey.status).toBe(403)
    expect(wrongProject.status).toBe(404)
    expect(noEnvelope.status).toBe(400)
    expect(server.events).toHaveLength(0)
  })

  it('answers with a forced status until clear()', async () => {
    const server = createFakeSentryServer()
    const url = 'https://errors.test/api/1/envelope/?sentry_key=public'

    server.answer(429, { 'Retry-After': '60' })
    const limited = await server.handle(post(url))
    server.clear()
    const taken = await server.handle(post(url))

    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(taken.status).toBe(200)
    expect(server.events).toHaveLength(1)
  })
})
