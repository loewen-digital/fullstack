---
title: Security
description: CSRF tokens, CORS headers, rate limiting and HTML sanitizing on Web Standard types
---

# Security

The `security` module bundles four HTTP security primitives: CSRF tokens bound to a session id, CORS response headers, a rate limiter in memory or on Cloudflare's Rate Limiting binding, and HTML sanitizing. Everything works on `Request`, `Response` and `Headers`; nothing reads cookies or bodies for you, the framework adapter or your handler does that.

In SvelteKit, `createHandle` from the [adapter](/adapters/sveltekit) checks the CSRF header on every mutating request and puts the result on `locals.csrfVerified`; the [Auth on flatdb](/guides/auth-on-flatdb) guide shows the surrounding setup.

## Import

```ts
import { createSecurity } from '@loewen-digital/fullstack/security'
```

## Setup

```ts
import { createSecurity } from '@loewen-digital/fullstack/security'

const security = createSecurity({
  csrf: { secret: process.env.CSRF_SECRET! },
  cors: { origins: ['https://example.com', 'https://app.example.com'], credentials: true },
  rateLimit: { windowMs: 60_000, max: 100 },
})
```

## CSRF tokens

A token is an HMAC over the session id and a random nonce, signed with `csrf.secret`. It has no expiry of its own; it is valid as long as the session id is. Mint one per form, verify it in the action against the same session id. Without a secret both calls throw.

```ts
async function renderForm(sessionId: string) {
  const token = await security.generateCsrfToken(sessionId) // <input type="hidden" name="_csrf" value={token}>
  return token
}

async function handleForm(sessionId: string, form: FormData) {
  if (!(await security.verifyCsrfToken(sessionId, String(form.get('_csrf'))))) {
    return new Response('Forbidden', { status: 403 })
  }
  return new Response('OK')
}
```

## CORS

`corsHeaders(origin, config?)` returns the `Headers` for a request's `Origin`; merge them into the response. An origin outside `cors.origins` gets no CORS headers at all. A preflight is the same call on an `OPTIONS` request, answered with an empty 204.

```ts
function withCors(request: Request, response: Response): Response {
  const headers = security.corsHeaders(request.headers.get('origin'))
  headers.forEach((value, name) => response.headers.set(name, value))
  return response
}

function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: security.corsHeaders(request.headers.get('origin')) })
}
```

## Rate limiting

`createRateLimiter(config?)` is a fixed-window counter in memory: per process, and on Cloudflare Workers per isolate, where a limit of five holds five times per isolate and location. `check(key)` counts one hit for `key` and reports whether it stayed within `max` for the current window, with `remaining` and `resetAt`. The key is yours: user id, route, client IP.

```ts
const limiter = security.createRateLimiter({ windowMs: 60_000, max: 100 })

async function tooManyRequests(request: Request): Promise<Response | null> {
  const key = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'anonymous'
  const result = await limiter.check(key) // { allowed, remaining?, resetAt? }
  if (result.allowed) return null

  const headers = new Headers()
  if (result.resetAt) headers.set('retry-after', String(Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)))
  return new Response('Too Many Requests', { status: 429, headers })
}

await limiter.reset('user:42') // forget a key
```

### On Cloudflare Workers

The [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) counts outside the isolate. The limit is configured on the binding, not in code: an entry under `ratelimits` in the wrangler config names it and sets `limit` hits per `period` of 10 or 60 seconds. `windowMs` and `max` have no say there and are rejected next to `binding`.

```jsonc
// wrangler.jsonc
{
  "ratelimits": [{ "name": "LOGIN_LIMITER", "namespace_id": "1001", "simple": { "limit": 5, "period": 60 } }]
}
```

`createBindingRateLimiter({ binding })`, or `createSecurity({ rateLimit: { binding } })` and `security.createRateLimiter()`, answers the same `RateLimiter` as the memory counter, so app code does not change. What the binding does not tell, the result does not invent: `check(key)` reports `allowed` and nothing else, `remaining` and `resetAt` are absent. `reset(key)` does nothing, the binding has no reset; the counter runs out with its period. The count is per Cloudflare location and eventually consistent, so a burst can pass a few hits over the limit. Cloudflare recommends user or tenant ids as keys rather than IP addresses, which many users share.

```ts
import { createBindingRateLimiter } from '@loewen-digital/fullstack/security'

export function loginLimiter(binding: RateLimit) {
  return createBindingRateLimiter({ binding }) // platform.env.LOGIN_LIMITER in a SvelteKit hook, env.LOGIN_LIMITER in a Worker
}

async function loginAllowed(binding: RateLimit, email: string): Promise<boolean> {
  const { allowed } = await loginLimiter(binding).check(`login:${email.toLowerCase()}`)
  return allowed
}
```

## Sanitizing

`sanitize(input)` removes `<script>` blocks, `on*` handlers and `javascript:`, `data:` and `vbscript:` URLs, then strips every remaining tag: plain text comes out. `escapeHtml(input)` turns `& < > " '` into entities for text nodes and attributes. Rich user HTML with an allowed tag list is not this module's job; use DOMPurify or sanitize-html there.

```ts
import { escapeHtml } from '@loewen-digital/fullstack/security'

const plain = security.sanitize('<b onclick="x()">Hi</b><script>steal()</script>') // 'Hi'
const safe = escapeHtml('<a href="x">') // '&lt;a href=&quot;x&quot;&gt;'
```

## Standalone functions

Every primitive is also a plain export, for one-off use without an instance: `generateCsrfToken(sessionId, secret)`, `verifyCsrfToken(sessionId, token, secret)`, `corsHeaders(origin, config)`, `createRateLimiter(config)`, `createBindingRateLimiter({ binding })`, `sanitize(input)` and `escapeHtml(input)`.

## Config options

`createSecurity(config)` reads these; every part is optional. `csrf: true` without a secret is the same as no secret.

| Option | Type | Default | Description |
|---|---|---|---|
| `csrf.secret` | `string` | — | Signs CSRF tokens. Without it `generateCsrfToken` and `verifyCsrfToken` throw |
| `cors.origins` | `string[] \| '*'` | `'*'` | Allowed origins, matched exactly |
| `cors.methods` | `string[]` | GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS | `Access-Control-Allow-Methods` |
| `cors.allowedHeaders` | `string[]` | Content-Type, Authorization, X-Requested-With | `Access-Control-Allow-Headers` |
| `cors.exposedHeaders` | `string[]` | `[]` | `Access-Control-Expose-Headers` |
| `cors.credentials` | `boolean` | `false` | `Access-Control-Allow-Credentials` |
| `cors.maxAge` | `number` | `86400` | `Access-Control-Max-Age` in seconds |
| `rateLimit.windowMs` | `number` | `60000` | Window length in milliseconds, memory counter only |
| `rateLimit.max` | `number` | `60` | Hits per key and window, memory counter only |
| `rateLimit.binding` | `RateLimitBinding` | — | Cloudflare's Rate Limiting binding; its limit and period come from the wrangler config, `windowMs` and `max` are not accepted next to it |

`corsHeaders` and `createRateLimiter` on the instance take the same options as a per-call override.
