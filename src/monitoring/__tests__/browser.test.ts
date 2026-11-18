import { runInNewContext } from 'node:vm'
import { afterEach, describe, it, expect, vi } from 'vite-plus/test'
import {
  BOT_USER_AGENT,
  EARLY_ERROR_COLLECTOR,
  EARLY_ERROR_COLLECTOR_HASH,
  createBrowserErrorReporter,
  createNoiseFilter,
  describeElement,
} from '../browser.js'
import type { BrowserErrorReporterConfig } from '../browser.js'
import { createSentryDriver } from '../index.js'
import type { ErrorReport } from '../index.js'
import { createFakeErrorDriver, createFakeSentryServer } from '../../testing/index.js'

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

type PageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface FakeWindow extends EventTarget {
  location: { origin: string; href: string; pathname: string }
  navigator: { userAgent: string }
  performance: { timeOrigin: number }
  fetch: PageFetch
  __earlyErrors?: { events: Event[]; stop(): void }
}

/** A page at `https://app.example/items/42?tab=notes`, as far as the reporter looks at one */
function openPage(overrides: Partial<FakeWindow> = {}): FakeWindow {
  const win: FakeWindow = Object.assign(new EventTarget(), {
    location: {
      origin: 'https://app.example',
      href: 'https://app.example/items/42?tab=notes',
      pathname: '/items/42',
    },
    navigator: { userAgent: SAFARI },
    performance: { timeOrigin: Date.now() - 60_000 },
    fetch: vi.fn<PageFetch>(async () => new Response(null, { status: 200 })),
    ...overrides,
  })
  vi.stubGlobal('window', win)
  return win
}

/** An error whose stack runs through the app's own script */
function appError(message = 'no items', Type: ErrorConstructor = TypeError): Error {
  const error = new Type(message)
  error.stack = `${error.name}: ${message}\n    at render (https://app.example/_app/immutable/chunks/item.js:12:34)`
  return error
}

function errorEvent(init: Partial<ErrorEvent>, at?: number): Event {
  const event = Object.assign(new Event('error'), init)
  if (at !== undefined) Object.defineProperty(event, 'timeStamp', { value: at })
  return event
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason })
}

function start(config: Partial<BrowserErrorReporterConfig> = {}) {
  const driver = createFakeErrorDriver()
  const reporter = createBrowserErrorReporter({ driver, ...config })
  return { driver, reporter }
}

const flushed = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createBrowserErrorReporter', () => {
  it('reports an error nothing caught, with the route pattern and the browser', async () => {
    const win = openPage()
    const { driver, reporter } = start({
      environment: 'production',
      release: '1.4.0',
      route: () => '/items/[id]',
    })

    win.dispatchEvent(errorEvent({ error: appError() }))
    await reporter.flush()

    expect(driver.last()).toMatchObject({
      type: 'TypeError',
      message: 'no items',
      handled: false,
      source: 'error',
      runtime: 'browser',
      environment: 'production',
      release: '1.4.0',
      route: '/items/[id]',
      userAgent: SAFARI,
      frames: [
        {
          file: 'https://app.example/_app/immutable/chunks/item.js',
          function: 'render',
          line: 12,
          column: 34,
        },
      ],
    })
    expect(driver.last()?.method).toBeUndefined()
  })

  it('reports a promise that was rejected with an error and that nothing handled', async () => {
    const win = openPage()
    const { driver, reporter } = start()

    win.dispatchEvent(rejectionEvent(appError('save failed', Error)))
    await reporter.flush()

    expect(driver.last()).toMatchObject({
      type: 'Error',
      message: 'save failed',
      handled: false,
      source: 'unhandledrejection',
      route: null,
    })
  })

  it('reports what the app hands over, as handled unless it says otherwise', async () => {
    openPage()
    const { driver, reporter } = start({ route: () => '/items/[id]' })

    const reference = reporter.report(appError('first'))
    reporter.report(appError('second'), { handled: false, tags: { hook: 'handleError' } })
    await reporter.flush()

    expect(reference).toMatch(/^[0-9a-f]{32}$/)
    expect(driver.reports.map((report) => [report.message, report.handled, report.source])).toEqual(
      [
        ['first', true, 'report'],
        ['second', false, 'report'],
      ],
    )
    expect(driver.last()?.tags).toEqual({ hook: 'handleError' })
    expect(driver.last()?.reference).not.toBe(reference)
  })

  describe('when there is nothing to report to', () => {
    it('does nothing without a driver: no listener, no wrapped fetch', () => {
      const pageFetch = vi.fn<PageFetch>()
      const win = openPage({ fetch: pageFetch })
      const listen = vi.spyOn(win, 'addEventListener')

      const reporter = createBrowserErrorReporter({ driver: undefined })

      expect(listen).not.toHaveBeenCalled()
      expect(win.fetch).toBe(pageFetch)
      expect(reporter.report(new Error('boom'))).toMatch(/^[0-9a-f]{32}$/)
      expect(() => reporter.stop()).not.toThrow()
    })

    it('sends nothing through the Sentry driver without a DSN', async () => {
      const pageFetch = vi.fn<PageFetch>()
      const win = openPage({ fetch: pageFetch })

      const reporter = createBrowserErrorReporter({
        driver: createSentryDriver({ dsn: undefined }),
      })
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(pageFetch).not.toHaveBeenCalled()
      expect(win.fetch).toBe(pageFetch)
    })

    it.each([
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (Linux; Android 11) Chrome/141.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)',
    ])('does nothing for the bot %j', async (userAgent) => {
      const win = openPage({ navigator: { userAgent } })
      const listen = vi.spyOn(win, 'addEventListener')
      const { driver, reporter } = start()

      win.dispatchEvent(errorEvent({ error: appError() }))
      reporter.report(appError('by hand'))
      await reporter.flush()

      expect(BOT_USER_AGENT.test(userAgent)).toBe(true)
      expect(listen).not.toHaveBeenCalled()
      expect(driver.reports).toHaveLength(0)
    })

    it('takes more user agents from the app', async () => {
      const win = openPage({ navigator: { userAgent: `${SAFARI} AcmeMonitor/2` } })
      const { driver, reporter } = start({ ignoreUserAgents: [/AcmeMonitor/] })

      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })

    it('does nothing on a server, where there is no window', async () => {
      const { driver, reporter } = start()

      expect(reporter.report(new Error('boom'))).toMatch(/^[0-9a-f]{32}$/)
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })
  })

  describe('the collector', () => {
    const install = (win: FakeWindow): void => {
      // The inline script, as the browser runs it before any other.
      runInNewContext(EARLY_ERROR_COLLECTOR, { window: win })
    }

    it('stays under 1 kB and has the hash a Content Security Policy names it by', async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(EARLY_ERROR_COLLECTOR),
      )
      const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))

      expect(new TextEncoder().encode(EARLY_ERROR_COLLECTOR).length).toBeLessThan(1024)
      expect(EARLY_ERROR_COLLECTOR_HASH).toBe(`sha256-${base64}`)
      expect(EARLY_ERROR_COLLECTOR).not.toContain('</script')
    })

    it('keeps what is thrown before the reporter starts, and hands it in afterwards', async () => {
      const started = Date.now() - 60_000
      const win = openPage({ performance: { timeOrigin: started } })
      install(win)

      win.dispatchEvent(errorEvent({ error: appError('while loading') }, 1200))
      win.dispatchEvent(rejectionEvent(appError('early rejection', Error)))
      const { driver, reporter } = start()
      await reporter.flush()

      expect(driver.reports.map((report) => [report.message, report.source])).toEqual([
        ['while loading', 'error'],
        ['early rejection', 'unhandledrejection'],
      ])
      // The moment it happened, not the moment it was handed in.
      expect(driver.reports[0]?.timestamp).toBe(new Date(started + 1200).toISOString())
      expect(win.__earlyErrors?.events).toEqual([])
    })

    it('stops when the reporter takes over, so nothing is reported twice', async () => {
      const win = openPage()
      install(win)
      const { driver, reporter } = start()

      win.dispatchEvent(errorEvent({ error: appError('after the start') }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(1)
      expect(win.__earlyErrors?.events).toEqual([])
    })

    it('keeps 20 events at most', () => {
      const win = openPage()
      install(win)

      for (let i = 0; i < 30; i++) win.dispatchEvent(errorEvent({ error: appError(`error ${i}`) }))

      expect(win.__earlyErrors?.events).toHaveLength(20)
    })

    it('starts without a collector, and with one that is broken', async () => {
      const win = openPage()
      win.__earlyErrors = {
        events: [errorEvent({ error: appError('kept') })],
        stop() {
          throw new Error('not ours')
        },
      }

      const { driver, reporter } = start()
      win.dispatchEvent(errorEvent({ error: appError('live') }))
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual(['live'])
    })
  })

  describe('what is no fault of the app', () => {
    it.each([
      ['TypeError', 'Failed to fetch'],
      ['TypeError', 'Load failed'],
      ['TypeError', 'NetworkError when attempting to fetch resource.'],
      ['TypeError', 'cancelled'],
      ['TypeError', 'Abgebrochen'],
      ['AbortError', 'signal is aborted without reason'],
      ['Error', 'The operation was aborted.'],
      ['TypeError', 'Importing a module script failed.'],
      ['TypeError', 'error loading dynamically imported module: https://app.example/_app/3.js'],
      [
        'TypeError',
        'Failed to fetch dynamically imported module: https://app.example/_app/immutable/nodes/3.abc.js',
      ],
      ['TypeError', "undefined is not an object (evaluating 'window.__gCrWeb.edgeTranslate')"],
      ['ReferenceError', "Can't find variable: __firefox__"],
      ['TypeError', 'instantSearchSDKJSBridgeClearHighlight is not defined'],
      ['ReferenceError', "Can't find variable: _AutofillCallbackHandler"],
      ['ReferenceError', "Can't find variable: gmo"],
      ['Error', 'Java exception was raised during method invocation'],
      ['TypeError', 'can\'t redefine non-configurable property "solana"'],
      ['TypeError', 'Cannot redefine property: googletag'],
      ['Error', 'ResizeObserver loop completed with undelivered notifications.'],
      ['Error', 'ResizeObserver loop limit exceeded'],
    ])('drops %s: %s', async (type, message) => {
      const win = openPage()
      const { driver, reporter } = start()
      const error = appError(message, Error)
      error.name = type

      win.dispatchEvent(errorEvent({ error }))
      win.dispatchEvent(rejectionEvent(error))
      reporter.report(error)
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })

    it.each([
      [TypeError, "Cannot read properties of undefined (reading 'title')"],
      [ReferenceError, 'total is not defined'],
      [RangeError, 'Maximum call stack size exceeded'],
      [Error, 'The cart could not be saved'],
      [TypeError, 'Failed to fetch the settings'],
    ])('lets a real fault through: %o', async (Type, message) => {
      const win = openPage()
      const { driver, reporter } = start()

      win.dispatchEvent(errorEvent({ error: appError(message, Type as ErrorConstructor) }))
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual([message])
    })

    it('drops a rejection with something that is no error', async () => {
      const win = openPage()
      const { driver, reporter } = start()

      win.dispatchEvent(rejectionEvent('redirect'))
      win.dispatchEvent(rejectionEvent({ status: 302, location: '/login' }))
      win.dispatchEvent(rejectionEvent(undefined))
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })

    it('drops what the browser says about a script of another origin', async () => {
      const win = openPage()
      const { driver, reporter } = start()

      win.dispatchEvent(errorEvent({ message: 'Script error.', filename: '', lineno: 0, colno: 0 }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })

    it.each([
      'https://cdn.ads.example/tag.js',
      'chrome-extension://abcdefgh/content.js',
      'moz-extension://1b2c/inject.js',
      'safari-web-extension://1b2c/inject.js',
      'webkit-masked-url://hidden/',
      'https://app-example.translate.goog/_app/item.js',
      'user-script:3',
    ])('drops an error whose newest frame is %s', async (script) => {
      const win = openPage()
      const { driver, reporter } = start()
      const error = new TypeError('x is undefined')
      error.stack = `TypeError: x is undefined\n    at run (${script}:1:2)\n    at render (https://app.example/_app/item.js:3:4)`

      win.dispatchEvent(errorEvent({ error }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(0)
    })

    it('counts the page’s origin with and without www, and the origins the app adds', async () => {
      const win = openPage()
      const { driver, reporter } = start({ origins: ['https://static.app.example/'] })
      const from = (script: string, message: string): Error => {
        const error = new TypeError(message)
        error.stack = `TypeError: ${message}\n    at run (${script}:1:2)`
        return error
      }

      win.dispatchEvent(errorEvent({ error: from('https://www.app.example/_app/a.js', 'www') }))
      win.dispatchEvent(errorEvent({ error: from('https://static.app.example/b.js', 'cdn') }))
      win.dispatchEvent(errorEvent({ error: from('https://app.example.evil.test/c.js', 'other') }))
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual(['www', 'cdn'])
    })

    it('lets an error without any script in its stack through', async () => {
      const win = openPage()
      const { driver, reporter } = start()
      const error = new TypeError('x is undefined')
      error.stack = 'TypeError: x is undefined\n    at Array.map (<anonymous>)'

      win.dispatchEvent(errorEvent({ error }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(1)
    })

    it('reports a fault of the app’s own bridge to its iOS shell, and drops the injected kind', async () => {
      const win = openPage()
      const { driver, reporter } = start()
      const message = "undefined is not an object (evaluating 'window.webkit.messageHandlers.pay')"
      const injected = new TypeError(message)
      injected.stack = '@user-script:12:5\nglobal code@[native code]'
      const anonymous = new TypeError(message)
      anonymous.stack = ''

      win.dispatchEvent(errorEvent({ error: injected }))
      win.dispatchEvent(errorEvent({ error: anonymous }))
      win.dispatchEvent(errorEvent({ error: appError(message) }))
      await reporter.flush()

      expect(driver.reports).toHaveLength(1)
      expect(driver.last()?.frames[0]?.file).toBe(
        'https://app.example/_app/immutable/chunks/item.js',
      )
    })

    it('reports an error that repeats in a row once', async () => {
      const win = openPage()
      const { driver, reporter } = start()

      for (let i = 0; i < 5; i++) win.dispatchEvent(errorEvent({ error: appError('in a loop') }))
      win.dispatchEvent(errorEvent({ error: appError('another one') }))
      win.dispatchEvent(errorEvent({ error: appError('in a loop') }))
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual([
        'in a loop',
        'another one',
        'in a loop',
      ])
    })

    it('takes more messages and scripts from the app', async () => {
      const win = openPage()
      const { driver, reporter } = start({
        ignoreMessages: ['quota exceeded', /^Map tiles? not loaded$/g],
        ignoreScripts: [/\/_app\/legacy\//],
      })
      const legacy = new TypeError('old code')
      legacy.stack = 'TypeError: old code\n    at https://app.example/_app/legacy/widget.js:1:2'

      win.dispatchEvent(errorEvent({ error: appError('The quota exceeded its limit') }))
      win.dispatchEvent(errorEvent({ error: appError('Map tile not loaded') }))
      win.dispatchEvent(errorEvent({ error: appError('Map tiles not loaded') }))
      win.dispatchEvent(errorEvent({ error: legacy }))
      win.dispatchEvent(errorEvent({ error: appError('kept') }))
      await reporter.flush()

      expect(driver.reports.map((report) => report.message)).toEqual(['kept'])
    })

    it('hands the app’s own filter the finished report', async () => {
      const win = openPage()
      const seen: ErrorReport[] = []
      const { driver, reporter } = start({
        route: () => '/items/[id]',
        filter(report) {
          seen.push(report)
          return report.route !== '/items/[id]'
        },
      })

      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(seen[0]?.userAgent).toBe(SAFARI)
      expect(driver.reports).toHaveLength(0)
    })
  })

  describe('what a report leaves out', () => {
    it('has the route pattern where the page’s address would stand', async () => {
      const win = openPage()
      const { driver, reporter } = start({ route: () => '/items/[id]' })
      // A script in the page itself: the engine names it by the page's address.
      const inline = new TypeError('no items')
      inline.stack =
        'TypeError: no items\n    at https://app.example/items/42?tab=notes:31:7\n    at start (https://app.example/_app/start.js:1:9)'

      win.dispatchEvent(errorEvent({ error: inline }))
      await reporter.flush()

      const report = driver.last()!
      expect(report.route).toBe('/items/[id]')
      expect(report.frames.map((frame) => frame.file)).toEqual([
        'https://app.example/[page]',
        'https://app.example/_app/start.js',
      ])
      const sent = JSON.stringify(report)
      expect(sent).not.toContain('/items/42')
      expect(sent).not.toContain('tab=notes')
    })

    it('renames a frame of the page the user first opened, after a navigation', async () => {
      const win = openPage()
      const { driver, reporter } = start()
      win.location.pathname = '/settings'
      win.location.href = 'https://app.example/settings'
      const inline = new TypeError('no items')
      inline.stack = 'TypeError: no items\n    at https://app.example/items/42:31:7'

      win.dispatchEvent(errorEvent({ error: inline }))
      await reporter.flush()

      expect(driver.last()?.frames[0]?.file).toBe('https://app.example/[page]')
    })

    it('reports what was thrown without an error object, by what the event says', async () => {
      const win = openPage()
      const { driver, reporter } = start()

      win.dispatchEvent(
        errorEvent({
          message: 'Uncaught out of stock',
          filename: 'https://app.example/_app/cart.js?v=3',
          lineno: 8,
          colno: 2,
        }),
      )
      await reporter.flush()

      expect(driver.last()).toMatchObject({
        type: 'Error',
        message: 'out of stock',
        frames: [{ file: 'https://app.example/_app/cart.js', line: 8, column: 2 }],
      })
    })

    it('survives a route function that throws', async () => {
      const win = openPage()
      const { driver, reporter } = start({
        route() {
          throw new Error('no router yet')
        },
      })

      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(driver.last()?.route).toBeNull()
    })
  })

  describe('breadcrumbs', () => {
    const button = {
      tagName: 'BUTTON',
      id: 'save',
      className: 'primary  wide extra more',
      textContent: 'Save Ada’s note',
      getAttribute: (name: string) => (name === 'name' ? 'intent' : null),
      parentElement: {
        tagName: 'FORM',
        id: '',
        className: 'note-form',
        getAttribute: () => null,
        parentElement: { tagName: 'MAIN', id: '', className: '', getAttribute: () => null },
      },
    }

    function click(win: FakeWindow, target: unknown): void {
      const event = new Event('click')
      Object.defineProperty(event, 'target', { value: target })
      win.dispatchEvent(event)
    }

    it('names a click by the element, never by its text', async () => {
      const win = openPage()
      const { driver, reporter } = start()

      click(win, button)
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(driver.last()?.breadcrumbs).toEqual([
        {
          type: 'click',
          timestamp: expect.any(String),
          target: 'main > form.note-form > button#save.primary.wide.extra[name="intent"]',
        },
      ])
      expect(JSON.stringify(driver.last())).not.toContain('Ada')
    })

    it('names a request by its host alone, and by the route pattern the app answers', async () => {
      const win = openPage()
      const { driver, reporter } = start({
        routeOf: (url) => (url.pathname.startsWith('/api/items/') ? '/api/items/[id]' : null),
      })

      await win.fetch('/api/items/42?token=secret', { method: 'put' })
      await win.fetch('/api/users/ada?include=email')
      await win.fetch(new URL('https://api.partner.example/v1/orders/9000'))
      await win.fetch(new Request('https://app.example/api/items/7', { method: 'DELETE' }))
      await flushed()
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(driver.last()?.breadcrumbs).toEqual([
        {
          type: 'http',
          timestamp: expect.any(String),
          method: 'PUT',
          target: '/api/items/[id]',
          status: 200,
        },
        {
          type: 'http',
          timestamp: expect.any(String),
          method: 'GET',
          target: 'app.example',
          status: 200,
        },
        {
          type: 'http',
          timestamp: expect.any(String),
          method: 'GET',
          target: 'api.partner.example',
          status: 200,
        },
        {
          type: 'http',
          timestamp: expect.any(String),
          method: 'DELETE',
          target: '/api/items/[id]',
          status: 200,
        },
      ])
      const sent = JSON.stringify(driver.last())
      for (const personal of ['secret', 'ada', '9000', '/api/items/42']) {
        expect(sent).not.toContain(personal)
      }
    })

    it('records the status of an answer, and a request that got none', async () => {
      const answers: (() => Promise<Response>)[] = [
        async () => new Response(null, { status: 503 }),
        async () => {
          throw new TypeError('Failed to fetch')
        },
      ]
      const win = openPage({ fetch: () => answers.shift()!() })
      const { driver, reporter } = start()

      await win.fetch('/api/items')
      await expect(win.fetch('/api/items')).rejects.toThrow('Failed to fetch')
      await flushed()
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(
        driver.last()?.breadcrumbs.map((crumb) => crumb.type === 'http' && crumb.status),
      ).toEqual([503, null])
    })

    it('hands the page’s fetch what it was called with, and its answer back unchanged', async () => {
      const answer = new Response('{"ok":true}')
      const pageFetch = vi.fn<PageFetch>(async () => answer)
      const win = openPage({ fetch: pageFetch })
      start()
      const init = { method: 'POST', body: 'x' }

      const response = await win.fetch('/api/items', init)

      expect(response).toBe(answer)
      expect(pageFetch).toHaveBeenCalledWith('/api/items', init)
    })

    it('writes a navigation when the route pattern changed, from pattern to pattern', async () => {
      const win = openPage()
      let current: string | null = '/items/[id]'
      const { driver, reporter } = start({ route: () => current })

      click(win, button)
      current = '/settings'
      click(win, button)
      current = '/items/[id]'
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(
        driver
          .last()
          ?.breadcrumbs.map((crumb) =>
            crumb.type === 'navigation' ? `${crumb.from} -> ${crumb.to}` : crumb.type,
          ),
      ).toEqual(['click', '/items/[id] -> /settings', 'click', '/settings -> /items/[id]'])
      expect(driver.last()?.route).toBe('/items/[id]')
    })

    it('keeps the newest 30, or as many as the app says', async () => {
      const win = openPage()
      const { driver, reporter } = start({ maxBreadcrumbs: 3 })

      for (const id of ['a', 'b', 'c', 'd', 'e']) click(win, { tagName: 'A', id })
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(
        driver.last()?.breadcrumbs.map((crumb) => crumb.type === 'click' && crumb.target),
      ).toEqual(['a#c', 'a#d', 'a#e'])
    })

    it('records nothing and leaves fetch alone with maxBreadcrumbs 0', async () => {
      const pageFetch = vi.fn<PageFetch>(async () => new Response(null))
      const win = openPage({ fetch: pageFetch })
      const { driver, reporter } = start({ maxBreadcrumbs: 0 })

      click(win, button)
      win.dispatchEvent(errorEvent({ error: appError() }))
      await reporter.flush()

      expect(win.fetch).toBe(pageFetch)
      expect(driver.last()?.breadcrumbs).toEqual([])
    })

    it('leaves no breadcrumb for the report it sends, and sends it so that it survives the page', async () => {
      const server = createFakeSentryServer()
      const requests: (RequestInit | undefined)[] = []
      const win = openPage({
        fetch: (input, init) => {
          requests.push(init)
          return server.handle(new Request(input, init))
        },
      })
      const reporter = createBrowserErrorReporter({
        driver: createSentryDriver({ dsn: server.dsn }),
        route: () => '/items/[id]',
      })

      win.dispatchEvent(errorEvent({ error: appError('first') }))
      await reporter.flush()
      win.dispatchEvent(errorEvent({ error: appError('second') }))
      await reporter.flush()

      expect(server.events).toHaveLength(2)
      expect(server.events[1]?.breadcrumbs).toBeUndefined()
      expect(server.events[1]?.transaction).toBe('/items/[id]')
      expect(server.events[1]?.tags.runtime).toBe('browser')
      expect(requests[0]?.keepalive).toBe(true)
      expect(requests[0]?.redirect).toBeUndefined()
    })
  })

  it('takes its listeners off the page and puts fetch back on stop()', async () => {
    const pageFetch = vi.fn<PageFetch>(async () => new Response(null))
    const win = openPage({ fetch: pageFetch })
    const { driver, reporter } = start()
    expect(win.fetch).not.toBe(pageFetch)

    reporter.stop()
    win.dispatchEvent(errorEvent({ error: appError() }))
    win.dispatchEvent(rejectionEvent(appError('later', Error)))
    await reporter.flush()

    expect(win.fetch).toBe(pageFetch)
    expect(driver.reports).toHaveLength(0)
  })
})

describe('createNoiseFilter', () => {
  const report = (overrides: Partial<ErrorReport>): ErrorReport => ({
    reference: '0123456789abcdef0123456789abcdef',
    timestamp: '2026-11-18T10:00:00.000Z',
    type: 'TypeError',
    message: 'no items',
    frames: [{ file: 'https://app.example/_app/item.js', line: 1 }],
    causes: [],
    handled: false,
    source: 'error',
    runtime: 'browser',
    route: null,
    breadcrumbs: [],
    tags: {},
    ...overrides,
  })

  it('tries a pattern on the message and on type and message together', () => {
    const isNoise = createNoiseFilter({ origins: ['https://app.example'] })

    expect(isNoise(report({ type: 'TypeError', message: 'Failed to fetch' }))).toBe(true)
    expect(isNoise(report({ type: 'AbortError', message: 'Fetch is aborted' }))).toBe(true)
    expect(isNoise(report({ type: 'TypeError', message: 'Failed to fetch the list' }))).toBe(false)
  })

  it('judges a stack by its newest frame that names a script', () => {
    const isNoise = createNoiseFilter({ origins: ['https://app.example'] })

    expect(
      isNoise(
        report({
          message: 'a',
          frames: [{ function: 'Array.map' }, { file: 'https://cdn.example/tag.js' }],
        }),
      ),
    ).toBe(true)
    expect(
      isNoise(
        report({
          message: 'b',
          frames: [
            { function: 'Array.map' },
            { file: 'https://app.example/_app/a.js' },
            { file: 'https://cdn.example/lib.js' },
          ],
        }),
      ),
    ).toBe(false)
  })
})

describe('describeElement', () => {
  it('answers null for what is no element', () => {
    expect(describeElement(null)).toBeNull()
    expect(describeElement({ nodeType: 9 })).toBeNull()
  })

  it('leaves out the class of an SVG element, which is no string', () => {
    expect(describeElement({ tagName: 'svg', className: { baseVal: 'icon' }, id: 'logo' })).toBe(
      'svg#logo',
    )
  })

  it('cuts a long description', () => {
    const element = { tagName: 'DIV', id: 'x'.repeat(300) }

    expect(describeElement(element)).toHaveLength(120)
  })
})
