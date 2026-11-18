---
title: Monitoring
description: Error reports from the browser and the server through a driver, a heartbeat ping for scheduled jobs and a health answer for uptime monitors
---

# Monitoring

The module tells you what failed without anybody having to look into a log. `createErrorReporter` reports a caught error from a server, `createBrowserErrorReporter` catches what nothing else caught on a page, `heartbeat` tells a monitor that a job ran, and `createHealthHandler` answers an uptime monitor.

Reports go through a driver. The reporter turns an error into a report: type, message, stack, the app's route pattern. The driver knows one server's format and address and nothing else. `createSentryDriver` speaks the Sentry protocol, which Sentry, GlitchTip and Bugsink take; `createConsoleDriver` prints; a driver of your own is one function. What a report carries is decided before any driver sees it, so it holds for every server: no address, no user, no cookie, no request body, no query string.

The module imports no other module and has no dependency. It needs `fetch` and nothing else, on Cloudflare Workers, on Node and in the browser.

## Import

```ts
import {
  createErrorReporter,
  createSentryDriver,
  createConsoleDriver,
  createHealthHandler,
  heartbeat,
} from '@loewen-digital/fullstack/monitoring'
import { createBrowserErrorReporter } from '@loewen-digital/fullstack/monitoring/browser'
```

## Reports from the server

```ts
// src/lib/server/errors.ts
import { createErrorReporter, createSentryDriver } from '@loewen-digital/fullstack/monitoring'

export const reporter = createErrorReporter({
  driver: createSentryDriver({ dsn: process.env.ERROR_DSN }),
  environment: 'production',
  release: '1.4.0',
})
```

```ts
import { reporter } from '#lib/server/errors.js'

function answerFailure(error: unknown, request: Request, ctx: ExecutionContext): Response {
  const reference = reporter.report(error, {
    route: '/items/[id]', // the pattern, never the address
    method: request.method,
    handled: false,
    waitUntil: ctx,
  })
  return Response.json({ error: 'internal', reference }, { status: 500 })
}
```

`report()` answers the reference of the report at once: 32 hex characters to show on the error page and to find the report by. It never throws, whatever is handed over and whatever the driver does, and it does not wait: the delivery runs behind it, ends after `timeout` (5 seconds), and what it fails with goes to `onError` (`console.error` unless you set it).

| Option of `report()` | |
| --- | --- |
| `route` | The route pattern, like `/items/[id]`. The one thing a report says about where it happened |
| `method` | The HTTP method of the request |
| `handled` | `false` for an error nothing caught; `true` is the default, for one you caught and report anyway |
| `reference` | An id of your own in place of the generated one, like a request id (letters, digits, `.`, `_`, `:`, `-`; 64 at most) |
| `tags` | Tags on this report, next to the `tags` of the reporter |
| `waitUntil` | What keeps the runtime alive until the report is out: `ctx`, or `(promise) => ctx.waitUntil(promise)` |

| Option of `createErrorReporter()` | |
| --- | --- |
| `driver` | Where reports go. With `undefined` nothing is built and nothing is sent |
| `environment`, `release`, `tags` | On every report |
| `filter` | Sees the finished report; `false` drops it |
| `maxPerMinute` | Reports within a minute before the rest is dropped (30), so that an error in a loop does not take the error server down with it |
| `timeout`, `onError`, `fetch` | The delivery: its time limit, who is told about a failure, and the `fetch` the driver sends with |

`reporter.flush()` resolves when every delivery under way has ended: before a script exits, and in tests.

### A Worker

A Worker cuts off what still runs when the response is out, so hand over `ctx`. Create the reporter once per isolate and not per request: the reporter counts its reports per minute, and the driver remembers that the server asked for silence.

```ts
// src/worker.ts
import {
  createErrorReporter,
  createSentryDriver,
  heartbeat,
  type ErrorReporterInstance,
} from '@loewen-digital/fullstack/monitoring'

interface Env {
  ERROR_DSN?: string
  ENVIRONMENT?: string
  RELEASE?: string
  CLEANUP_HEARTBEAT_URL?: string
}

declare function handle(request: Request, env: Env): Promise<Response> // your app
declare function cleanUp(env: Env): Promise<void> // your job

let reporter: ErrorReporterInstance | undefined
const errors = (env: Env) =>
  (reporter ??= createErrorReporter({
    driver: createSentryDriver({ dsn: env.ERROR_DSN }),
    environment: env.ENVIRONMENT,
    release: env.RELEASE,
  }))

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (error) {
      const reference = errors(env).report(error, {
        route: '/api/items/[id]',
        method: request.method,
        handled: false,
        waitUntil: ctx,
      })
      return Response.json({ error: 'internal', reference }, { status: 500 })
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      await cleanUp(env)
      ctx.waitUntil(heartbeat(env.CLEANUP_HEARTBEAT_URL))
    } catch (error) {
      errors(env).report(error, { route: `cron ${controller.cron}`, handled: false, waitUntil: ctx })
    }
  },
}
```

In a Durable Object the state has `waitUntil`: `errors(this.env).report(error, { route: 'RoomObject.fetch', waitUntil: this.ctx })`.

### SvelteKit

`handleError` runs for every error thrown while a request is answered. `kind` says what it is: report the unknown ones, the errors your code did not mean to throw.

```ts
// src/hooks.server.ts
import type { HandleServerError } from '@sveltejs/kit/hooks'
import { reporter } from '#lib/server/errors.js'

export const handleError: HandleServerError = ({ kind, error, event }) => {
  if (kind !== 'unknown') return // a 404, a failed validation, an error the app threw on purpose
  const reference = reporter.report(error, {
    route: event.route.id,
    method: event.request.method,
    handled: false,
    waitUntil: event.platform?.ctx, // the Worker's context, from @sveltejs/adapter-cloudflare
  })
  return { reference }
}
```

`reference` then arrives on the error page as `page.error.reference`. It needs a place in the app's error type:

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Error {
      reference?: string
    }
  }
}

export {}
```

The samples are written for SvelteKit 3. On SvelteKit 2 the hook types come from `@sveltejs/kit`, the alias is `$lib/…`, `version` comes from `$app/environment`, and `handleError` gets `status` instead of `kind`: report where `status` is 500.

## Reports from the browser

```ts
// src/hooks.client.ts
import type { HandleClientError } from '@sveltejs/kit/hooks'
import { version } from '$app/env'
import { page } from '$app/state'
import { createSentryDriver } from '@loewen-digital/fullstack/monitoring'
import { createBrowserErrorReporter } from '@loewen-digital/fullstack/monitoring/browser'

// A DSN is public, so it can stand in the code. `undefined` where nothing is to be sent.
const dsn: string | undefined = 'https://abc123@errors.example.com/1'

const reporter = createBrowserErrorReporter({
  driver: createSentryDriver({ dsn }),
  environment: 'production',
  release: version,
  route: () => page.route.id,
})

// What SvelteKit catches while navigating never reaches the page's own error event.
export const handleError: HandleClientError = ({ kind, error }) => {
  if (kind !== 'unknown') return
  return { reference: reporter.report(error, { handled: false }) }
}
```

That one call starts the reporting: it listens for `error` and `unhandledrejection`, takes over what the [collector](#the-collector) kept, and reports what passes the filters. Call it once. Without a driver it does nothing at all: no listener, no wrapped `fetch`, no request. The same holds for a bot and on a server, so the call needs no guard of its own.

| Option, next to those of the server reporter | |
| --- | --- |
| `route` | The route pattern of the page the user is on. It stands in a report where the page's address would |
| `routeOf` | The route pattern a request of the page goes to, for its breadcrumb: `(url) => string \| null` |
| `ignoreMessages`, `ignoreScripts`, `ignoreUserAgents` | More to drop, next to the built-in lists |
| `origins` | More origins the app's own scripts come from, like a CDN's |
| `maxBreadcrumbs` | How many breadcrumbs a report carries (30). With 0 none are recorded and `fetch` is left alone |

The returned reporter has `report()` and `flush()` like the server's, and `stop()`, which takes the listeners off again.

### The collector

The reporter is part of your app's code, and an error can be thrown before that code has loaded. The collector is a script of 281 bytes for the head of the page, before every other script. It keeps up to 20 errors, and the reporter takes them over when it starts, each with the time it happened.

```html
<!-- src/app.html: the first thing in <head> -->
%errors.collector%
```

In `src/hooks.server.ts`, next to `handleError`:

```ts
import type { Handle } from '@sveltejs/kit/hooks'
import { EARLY_ERROR_COLLECTOR } from '@loewen-digital/fullstack/monitoring'

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%errors.collector%', `<script>${EARLY_ERROR_COLLECTOR}</script>`),
  })
```

Its source is fixed, so a Content Security Policy names it by its hash instead of opening `script-src` to inline scripts. Put it into the page exactly as it is, with no space or line break inside the tag. The server the reports go to belongs into `connect-src`.

```js
// svelte.config.js
import { EARLY_ERROR_COLLECTOR_HASH } from '@loewen-digital/fullstack/monitoring'

export default {
  kit: {
    csp: {
      directives: {
        'script-src': ['self', EARLY_ERROR_COLLECTOR_HASH],
        'connect-src': ['self', 'https://errors.example.com'],
      },
    },
  },
}
```

In a header you write yourself the hash stands in single quotes: `script-src 'self' 'sha256-…'`.

## What a report carries

| | |
| --- | --- |
| `reference`, `timestamp` | The id of the report and the moment the error was caught |
| `type`, `message` | The error's name and message. An address in the message loses its query string; the message ends after 1000 characters |
| `frames` | The stack as the engine wrote it, read for Chrome, Firefox, Safari, Node and workerd: script, function, line, column |
| `causes` | The chain of `cause`, up to five |
| `handled`, `source` | Whether something caught it, and how it arrived: handed over, an `error` event, an `unhandledrejection` |
| `runtime`, `environment`, `release`, `tags` | `browser` or `server`, and what you configured |
| `route`, `method` | The route pattern, and on a server the method |
| `userAgent` | The browser. Never set on a server |
| `breadcrumbs` | In the browser, what happened before: see below |

And what it never carries: the address of the page or of the request, a user, a cookie, a header, a request body, a query string, console output. There are no session pings and no traces; nothing is sent but errors.

- **The page's address.** The route pattern stands in its place. A script in the page itself is named by the engine with the page's address, ids included; such a frame is renamed to `https://app.example/[page]`.
- **Scripts.** The address of a script loses its query string and fragment.
- **Something thrown that is no error.** Of an object only its keys are named, never its values: `Object thrown with keys: email, status`.
- **Clicks.** A breadcrumb names the element by tag, id, its first classes and `name`, with two ancestors: `form.note-form > button#save.primary`. Never its text and never a value.
- **Requests.** A breadcrumb has the method, the status and the route pattern `routeOf` answers. Without an answer it has the host and nothing of the path: `/api/users/ada` becomes `app.example`.
- **Navigations.** From route pattern to route pattern, written when the pattern changed.

What your own code writes into a message, a tag, an id or a class name is yours: `new Error('no cart for ada@example.com')` is reported as written.

The server a report goes to sees the IP address the request comes from, as every server does. Whether it keeps it is a setting of that server.

A `routeOf` for an app with a handful of endpoints:

```ts
function routeOf(url: URL): string | null {
  if (url.origin !== location.origin) return null
  if (/^\/api\/items\/[^/]+$/.test(url.pathname)) return '/api/items/[id]'
  return url.pathname === '/api/items' ? '/api/items' : null
}
```

## What is dropped

A page's errors are mostly not the app's. The browser reporter drops:

- **Scripts of others.** An error whose newest frame is not from the page's origin (with and without `www.`, plus `origins`): ads, analytics, browser extensions (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`, `webkit-masked-url:`), a page rewritten by Google Translate. An error without any script in its stack passes.
- **The user's network.** `Failed to fetch`, `Load failed`, `NetworkError when attempting to fetch resource.`, aborted requests.
- **A chunk that is gone after a deploy.** The old page asks for a file the new deploy no longer has; a reload solves it.
- **In-app browsers and extensions** that inject code into every page, and the browser's remarks `Script error.` and `ResizeObserver loop …`.
- **A rejection with something that is no error.** A library's control flow, not a fault.
- **An error that repeats in a row.** Reported once.
- **Bots and headless browsers**, by user agent. For them the reporter does not start.

A real fault in your code, a `TypeError`, a `ReferenceError`, passes. The lists are exported (`IGNORED_MESSAGES`, `IGNORED_SCRIPTS`, `INJECTED_MESSAGES`, `BOT_USER_AGENT`) and an app adds to them:

```ts
const pageReporter = createBrowserErrorReporter({
  driver: createSentryDriver({ dsn: 'https://abc123@errors.example.com/1' }),
  routeOf,
  ignoreMessages: ['quota exceeded', /^Map tiles? not loaded$/], // a text that occurs, or a pattern
  ignoreScripts: [/\/_app\/legacy\//],
  ignoreUserAgents: [/AcmeMonitor/],
  filter: (report) => report.route !== '/embed/[id]', // the last word, on the finished report
})
```

A pattern is tried on the message and on `<type>: <message>`. One pattern is conditional: errors that mention `window.webkit.messageHandlers` come from code that in-app browsers inject, and they are dropped only when no frame of the stack is the app's own. An app inside an iOS shell talks to its shell through exactly that, and a fault there is reported.

A browser test finds no report when its user agent says `HeadlessChrome`, which is Playwright's default: give the test a real one.

## Drivers

### Sentry protocol: Sentry, GlitchTip, Bugsink

```ts
createSentryDriver({ dsn: 'https://<public key>@<host>/<project id>' })
```

- **No DSN, no driver.** With `undefined` or an empty string it answers `undefined`, and a reporter without a driver sends nothing. The same code runs where no server is set up.
- **A DSN that cannot be read** never stops the app: every delivery fails with that reason and `onError` is told.
- **A DSN is public.** It is in the source of every page that reports, and it only allows sending.
- **`http://` in the DSN.** A server behind a proxy that ends TLS shows its DSN with `http://`. From a page served over https the driver sends to `https://` instead; a server on `localhost` keeps `http://`. On a server the DSN is taken as written, and when the answer is a redirect to the same host the driver posts once more to where it points, with the report, which a plain redirect would lose.
- **Rate limits.** When the server answers 429, or names a limit for errors, the driver sends nothing for as long as it asks, an hour at most.
- **Source maps.** A report names the `release` you configured. Where your deploy runs the inject step of the source map tooling (`sentry-cli sourcemaps inject`, `glitchtip-cli sourcemaps inject`, the bundler plugins), each script carries a debug id; the driver reads those ids and sends them along, and the server finds the map by id, whatever the release is called. Uploading the maps is the deploy's job.
- **No preflight.** The envelope goes as plain text with the key in the query string, so a browser sends it without asking the server first, and with `keepalive`, so it survives the page being left.

The driver was built from the protocol's documentation and is tested against a fake server made from the same; it has not been run against a GlitchTip or Sentry installation yet. Send one report by hand after setting it up.

### Console

`createConsoleDriver()` prints each report with `console.error` as it would be sent, for development: it shows what the scrubbing left of an error.

```ts
import { dev } from '$app/env'

const driver = dev ? createConsoleDriver() : createSentryDriver({ dsn: process.env.ERROR_DSN })
```

### A driver of your own

```ts
import type { ErrorReportDriver } from '@loewen-digital/fullstack/monitoring'

const webhookDriver: ErrorReportDriver = {
  name: 'webhook',
  async send(report, { fetch, signal }) {
    const response = await fetch('https://hooks.example.com/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal,
    })
    if (!response.ok) throw new Error(`the webhook answered ${response.status}`)
  },
}
```

Send with the `fetch` you are handed: in the browser it is the one that leaves no breadcrumb. `signal` aborts when the reporter gives up. Resolve when the report was taken or deliberately dropped, reject when it was lost. `toSentryEvent(report)` and `toSentryEnvelope(event, sentAt)` are exported for a driver that speaks the same protocol to another address.

## Heartbeat

A monitor of the heartbeat kind waits for a request and raises the alarm when it stays away. Ping it after a job that succeeded; a job that fails or never starts then needs no code of its own.

```ts
declare function cleanUp(): Promise<void> // your job

async function nightly(env: { CLEANUP_HEARTBEAT_URL?: string }, ctx: ExecutionContext) {
  await cleanUp()
  ctx.waitUntil(heartbeat(env.CLEANUP_HEARTBEAT_URL))
}
```

`heartbeat(url, { timeout?, method?, fetch? })` answers whether the monitor took the ping. It never throws and gives up after `timeout` (5 seconds). Without an address it does nothing, so the job runs the same where no monitor is set up. The request is a `POST`, which GlitchTip's heartbeat monitors require; `method: 'GET'` is there for a monitor that wants it.

## Health

```ts
// src/routes/healthz/+server.ts
import { createHealthHandler } from '@loewen-digital/fullstack/monitoring'
import type { RequestHandler } from './$types'

declare function readsStorage(signal: AbortSignal): Promise<boolean> // one cheap read of your own

const health = createHealthHandler({
  checks: {
    storage: readsStorage,
    sessions: (signal) =>
      fetch('https://sessions.internal/ping', { signal }).then((response) => response.ok),
  },
})

export const GET: RequestHandler = ({ request }) => health(request)
```

The handler answers `200 ok` when every check passes and `503 unavailable` when one fails. A check passes unless it throws, rejects, answers `false` or takes longer than `timeout` (3 seconds); the checks run side by side.

An uptime monitor sends no credentials, so the endpoint is open to anyone. It therefore answers everyone the same two words: which check failed and why goes to `onFailure(name, error)` (`console.error` unless you set it) and never into the response, and the response is never cached. It takes `GET` and `HEAD` and runs the checks on every request: keep each to one cheap read, and put a rate limit in front where that is not enough.

## Testing

`createFakeErrorDriver()` takes the place of the driver and keeps each report as the reporter built it, whatever server the app reports to:

```ts
import { expect } from 'vitest'
import { createFakeErrorDriver } from '@loewen-digital/fullstack/testing'

const fakeErrors = createFakeErrorDriver()
const tested = createErrorReporter({ driver: fakeErrors })

async function assertsReports() {
  tested.report(new TypeError('no items'), { route: '/items/[id]', method: 'GET' })
  await tested.flush()

  expect(fakeErrors.last()?.route).toBe('/items/[id]')
}
```

`createFakeSentryServer()` stands where the server is and catches what the Sentry driver sends over the network, without one. See [Fakes](/testing/fakes#errors) for both, and for a browser test that routes the page's requests to the fake server.

## Runtimes and size

The built package was run in workerd, on Node, in Chromium and in Safari on the iOS simulator against a local fake server: reports from a fetch handler with and without waiting, through a redirect, the collector's hand-over, clicks and requests as breadcrumbs, and no address in any event. Firefox's stack format is covered by tests on stacks written in that format, not by a run in Firefox.

The browser reporter with the Sentry driver is about 15 kB minified and 6 kB gzipped, in your app's own client code. To keep it out of the first chunk, import the file that starts it with a dynamic `import()`; the collector holds what happens until then.
