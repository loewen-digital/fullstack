---
title: Fetch Adapter
description: createFetchAdapter validates the auth cookie of a Request and writes it to Headers, for Pages Functions, Workers, Hono and any other fetch handler
---

# Fetch Adapter

Some backends have no framework hook to run in: Cloudflare Pages Functions behind a static SvelteKit build, a bare Worker, a Hono app. They get a `Request` and return a `Response`. `createFetchAdapter({ auth })` is the auth wiring for them: `sessionOf(request)` validates the auth cookie, `setAuthCookie` and `clearAuthCookie` write it to the `Headers` of your response, and `isSameOrigin(request)` is the CSRF guard for a JSON API.

The adapter covers the auth session. The [session](/modules/session) module (flash messages, old input) and its CSRF tokens belong to server-rendered forms and are not part of it.

## Import

```ts
import { createFetchAdapter, isSameOrigin, isSecureRequest } from '@loewen-digital/fullstack/adapters/fetch'
```

## Pages Functions

### 1. Build auth and the adapter per request

Bindings arrive with the request, so the stack is built from `env` once per request. `secure: isSecureRequest(request)` leaves `Secure` off the cookie under `wrangler pages dev`, which serves plain HTTP; see [Secure](#secure).

```ts
// server/stack.ts
import { createAuth, type AuthDbAdapter, type AuthSession } from '@loewen-digital/fullstack/auth'
import { createFetchAdapter, isSecureRequest } from '@loewen-digital/fullstack/adapters/fetch'

export interface Env {
  DATA: R2Bucket
}

export declare function authDbOf(env: Env): AuthDbAdapter // createFlatdbAuthAdapter(...) from the guide

export function stackOf(request: Request, env: Env) {
  const db = authDbOf(env)
  const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db })
  const cookies = createFetchAdapter({ auth }, { secure: isSecureRequest(request) })
  return { db, auth, cookies }
}

/** What the middleware puts on `context.data`. */
export type Data = {
  stack: ReturnType<typeof stackOf>
  authSession: AuthSession | null
}
```

The [Auth on flatdb](/guides/auth-on-flatdb) guide shows `createFlatdbAuthAdapter` on an R2 bucket.

### 2. The middleware

`sessionOf(request)` returns `{ session, clearCookie }`. `session` is the validated `AuthSession` or `null`. `clearCookie` is `null` unless the request carried an auth cookie whose token is unknown or expired; then it is the `Set-Cookie` value that deletes the cookie, so the browser stops sending a dead token.

```ts
// functions/api/_middleware.ts
import { isSameOrigin } from '@loewen-digital/fullstack/adapters/fetch'
import { stackOf, type Env, type Data } from '../../server/stack'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const onRequest: PagesFunction<Env, string, Data> = async (context) => {
  const { request, env, data } = context
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return Response.json({ error: 'Cross-origin request' }, { status: 403 })
  }

  data.stack = stackOf(request, env)
  const { session, clearCookie } = await data.stack.cookies.sessionOf(request)
  data.authSession = session

  const response = await context.next()
  if (!clearCookie) return response

  const cleared = new Response(response.body, response)
  cleared.headers.append('Set-Cookie', clearCookie)
  return cleared
}
```

### 3. Guarding a function

`authSession.userId` is the key to load the user yourself; the adapter has no user store and puts no user object on `data`.

```ts
// functions/api/me.ts
import type { Env, Data } from '../../server/stack'

export const onRequestGet: PagesFunction<Env, string, Data> = async ({ data }) => {
  if (!data.authSession) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const user = await data.stack.db.findUserById(data.authSession.userId)
  return Response.json({ email: user?.email ?? null })
}
```

## Login and logout

The example logs in with a password; with [a code by mail](/modules/auth#login-by-e-mail-code) only the check before `createSession` differs. `setAuthCookie(headers, token)` appends the `Set-Cookie` header for the auth cookie: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Max-Age` of 7 days, `Secure` unless the options say otherwise. `clearAuthCookie(headers)` appends the header that deletes it. Both append, so other cookies on the same headers stay.

```ts
// functions/api/login.ts
import type { Env, Data } from '../../server/stack'

export const onRequestPost: PagesFunction<Env, string, Data> = async ({ request, data }) => {
  const { db, auth, cookies } = data.stack
  const { email, password } = (await request.json()) as { email: string; password: string }

  const user = await db.findUserByEmail(email)
  if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const session = await auth.createSession(user)
  const headers = new Headers()
  cookies.setAuthCookie(headers, session.token)
  return Response.json({ userId: user.id }, { headers })
}
```

```ts
// functions/api/logout.ts
import type { Env, Data } from '../../server/stack'

export const onRequestPost: PagesFunction<Env, string, Data> = async ({ data }) => {
  const { auth, cookies } = data.stack
  if (data.authSession) await auth.destroySession(data.authSession.token)

  const headers = new Headers()
  cookies.clearAuthCookie(headers)
  return new Response(null, { status: 204, headers })
}
```

## CSRF

A JSON API called with `fetch` from the app's own pages has no form to carry a token. `isSameOrigin(request, allowed?)` answers whether the browser says the request came from the app itself:

- `Origin`, which browsers send on every request that is not a GET or HEAD, has to equal the origin of the request URL or one of `allowed`.
- Without `Origin`, `Sec-Fetch-Site` has to be `same-origin`, or `none` (the user opened the URL; no site sent the request).
- With neither header the answer is `false`: the request is not from a current browser. A client that authenticates without the cookie, a bearer token from a script, is not a CSRF target; let it past the check yourself.

The check does not block anything; the handler decides, as the middleware above does for mutating methods. `allowed` lists further origins as the browser sends them, without a trailing slash: the app's own origin when the API lives on another host, or the public origin when a proxy hands the handler an internal URL.

```ts
declare const request: Request

isSameOrigin(request) // Origin equals the origin of request.url
isSameOrigin(request, ['https://app.example.com']) // or the listed one
```

## Secure

The helpers that write the cookie get response `Headers`, not the request, so they cannot tell HTTPS from plain HTTP. The cookie therefore carries `Secure` unless `secure` says otherwise, in the options or per call. Over plain HTTP a browser drops a `Secure` cookie unless it treats the host as trustworthy, and not every browser does that for `localhost`; `isSecureRequest(request)` gives the option the right value in both worlds. It reads the scheme of the request URL and, behind a proxy that terminates TLS, the first `x-forwarded-proto` value.

The deleting cookie of `sessionOf` follows the scheme of the request it was asked about.

## A bare Worker, Hono

Where the auth instance does not depend on the request, the adapter is built once.

```ts
// src/worker.ts
import { createFetchAdapter, isSameOrigin } from '@loewen-digital/fullstack/adapters/fetch'
import type { AuthInstance } from '@loewen-digital/fullstack/auth'

declare const auth: AuthInstance
const cookies = createFetchAdapter({ auth })

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && !isSameOrigin(request)) {
      return new Response('Forbidden', { status: 403 })
    }

    const { session, clearCookie } = await cookies.sessionOf(request)
    const headers = new Headers()
    if (clearCookie) headers.append('Set-Cookie', clearCookie)

    if (!session) return Response.json({ error: 'Not signed in' }, { status: 401, headers })
    return Response.json({ userId: session.userId }, { headers })
  },
}
```

In Hono the `Request` is `c.req.raw`; everything else is the same calls.

## Options

`createFetchAdapter(stack, options)` takes any object with `auth` and reads these options.

| Option | Default | Description |
|---|---|---|
| `authCookie` | `'fs_token'` | Name of the auth cookie |
| `secure` | `true` | Whether the cookie carries `Secure`; see [Secure](#secure) |
| `sameSite` | `'lax'` | `'lax'`, `'strict'` or `'none'`; `'none'` needs `secure` |
| `maxAge` | 7 days | Lifetime of the cookie in seconds; keep it in step with `sessionTtl` of the auth config |

## Helpers

| Helper | Description |
|---|---|
| `adapter.sessionOf(request)` | `{ session, clearCookie }`: the validated `AuthSession` or `null`, and the deleting `Set-Cookie` value for a dead token |
| `adapter.setAuthCookie(headers, token, { secure?, maxAge? })` | Appends the `Set-Cookie` header for the auth session token |
| `adapter.clearAuthCookie(headers, { secure? })` | Appends the `Set-Cookie` header that deletes it |
| `isSameOrigin(request, allowed?)` | Whether `Origin` or `Sec-Fetch-Site` place the request on the app's own origin or a listed one |
| `isSecureRequest(request)` | Whether the request came over HTTPS, by URL scheme or `x-forwarded-proto` |
