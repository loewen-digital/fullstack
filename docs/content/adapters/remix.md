---
title: Remix Adapter
description: createRemixLoader and createRemixAction hand loaders and actions the session, the auth session and the CSRF result
---

# Remix Adapter

Remix has no request-wide middleware; loaders and actions get a `Request` each. So the adapter wraps them: `createRemixLoader(stack)` and `createRemixAction(stack)` return wrappers that open the session from its cookie, validate the auth cookie, check the CSRF header on mutating requests, and call your function with the enriched args. Because the session lives in a cookie, your loader or action puts the `Set-Cookie` header on its response with `commitSession()`; `authCookieHeader` and `clearAuthCookieHeader` do the same for the auth cookie.

Remix already speaks `Request` and `Response`, so nothing is converted. The adapter imports nothing from Remix; it types the args it reads (`request`, `params`, `context`).

## Import

```ts
import { createRemixLoader, createRemixAction } from '@loewen-digital/fullstack/adapters/remix'
```

## Setup

### 1. Build the stack

The wrappers take any object with `session`, `auth` and `security`; each is optional and only the present modules run.

```ts
// app/lib/stack.server.ts
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'
import { createSession } from '@loewen-digital/fullstack/session'
import { createSecurity } from '@loewen-digital/fullstack/security'

export declare const authDb: AuthDbAdapter // yours, or createFlatdbAuthAdapter(...) from the guide

export const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: process.env.SESSION_SECRET! })
export const security = createSecurity({ csrf: { secret: process.env.CSRF_SECRET! } })
```

### 2. Create the wrappers once

```ts
// app/lib/fullstack.server.ts
import { createRemixLoader, createRemixAction } from '@loewen-digital/fullstack/adapters/remix'
import { auth, session, security } from './stack.server'

const stack = { auth, session, security }

export const withLoader = createRemixLoader(stack)
export const withAction = createRemixAction(stack)
```

## What the wrappers pass to your function

Your loader or action receives `FullstackRemixArgs`: Remix's `request`, `params` and `context`, plus:

| Property | Type | Set when |
|---|---|---|
| `session` | `SessionHandle \| undefined` | the stack has `session`. Flash, old input, values |
| `authSession` | `AuthSession \| null` | the stack has `auth`. The validated session behind the auth cookie, or `null` |
| `user` | `AuthUser \| null` | the stack has `auth`. Carries only `id` (`email` is empty): the adapter has no user store. Load the user yourself by `authSession.userId` |
| `csrfVerified` | `boolean` | the stack has `security` and the method is not GET, HEAD or OPTIONS. See [CSRF](#csrf) |
| `commitSession()` | `() => Promise<string>` | always. Saves the session and returns the `Set-Cookie` header value for it (`httpOnly`, `SameSite=Lax`, `Secure` on HTTPS, 7 days); an empty string without a session module |

Nothing is written for you: a response without the `Set-Cookie` header from `commitSession()` loses what the loader or action put into the session.

## Guarding a route

The route module's default export, the page component, is yours; the loader is what the adapter touches.

```ts
// app/routes/dashboard.tsx
import { json, redirect } from '@remix-run/node'
import { withLoader } from '~/lib/fullstack.server'

export const loader = withLoader(async ({ authSession, session, commitSession }) => {
  if (!authSession) throw redirect('/login')

  const notice = session?.getFlash<string>('notice')
  return json({ userId: authSession.userId, notice }, { headers: { 'Set-Cookie': await commitSession() } })
})
```

## Login and logout

`validateBody(request, session, rules)` parses JSON or form data, validates it with the [validation](/modules/validation) rules, and on failure flashes the errors as `_errors` and the input as old input. `authCookieHeader(token)` builds the `Set-Cookie` value for the auth cookie: `httpOnly`, `SameSite=Lax`, `maxAge` seconds (default 7 days). Two cookies on one response go through `Headers.append`.

```ts
// app/routes/login.tsx
import { json, redirect } from '@remix-run/node'
import { authCookieHeader, validateBody } from '@loewen-digital/fullstack/adapters/remix'
import { withAction } from '~/lib/fullstack.server'
import { auth, authDb } from '~/lib/stack.server'

export const action = withAction(async ({ request, session, commitSession }) => {
  const result = await validateBody(request, session, { email: 'required|email', password: 'required|string' })
  if (!result.ok) {
    return json({ errors: result.errors }, { status: 422, headers: { 'Set-Cookie': await commitSession() } })
  }

  const { email, password } = result.data as { email: string; password: string }
  const user = await authDb.findUserByEmail(email)
  if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    session?.flashInput({ email })
    return json({ error: 'Invalid credentials' }, { status: 401, headers: { 'Set-Cookie': await commitSession() } })
  }

  const authSession = await auth.createSession(user)
  session?.flash('notice', 'Welcome back')

  const headers = new Headers()
  headers.append('Set-Cookie', authCookieHeader(authSession.token, { secure: process.env.NODE_ENV === 'production' }))
  headers.append('Set-Cookie', await commitSession())
  return redirect('/dashboard', { headers })
})
```

```ts
// app/routes/logout.tsx
import { redirect } from '@remix-run/node'
import { clearAuthCookieHeader } from '@loewen-digital/fullstack/adapters/remix'
import { withAction } from '~/lib/fullstack.server'
import { auth } from '~/lib/stack.server'

export const action = withAction(async ({ authSession }) => {
  if (authSession) await auth.destroySession(authSession.token)
  return redirect('/login', { headers: { 'Set-Cookie': clearAuthCookieHeader() } })
})
```

## CSRF

With a `security` module in the stack, an action's args carry `csrfVerified`: the token in the `x-csrf-token` (or `x-xsrf-token`) header has to match the session id. The wrapper does not block the request; your action decides. Paths that start with one of `csrfExemptPaths` skip the check (webhooks).

Fetch clients send the header. An HTML form carries the token in a hidden field instead, so the action verifies it itself:

```ts
// app/routes/profile.tsx
import { json } from '@remix-run/node'
import { getCsrfToken } from '@loewen-digital/fullstack/adapters/remix'
import { withLoader, withAction } from '~/lib/fullstack.server'
import { security } from '~/lib/stack.server'

export const loader = withLoader(async ({ session, commitSession }) => {
  const csrf = await getCsrfToken({ session }, security) // <input type="hidden" name="_csrf" value={csrf}>
  return json({ csrf }, { headers: { 'Set-Cookie': await commitSession() } })
})

export const action = withAction(async ({ request, session }) => {
  const form = await request.formData()
  const sessionId = session?.id ?? ''
  if (!(await security.verifyCsrfToken(sessionId, String(form.get('_csrf'))))) {
    return json({ error: 'Invalid CSRF token' }, { status: 403 })
  }
  return json({ saved: true })
})
```

## One request without the wrappers

`withFullstack(args, stack, options)` builds the same `FullstackRemixArgs` for a single call, for code shared between a loader and an action or for a resource route that wants the args in the middle of other work.

```ts
// app/routes/api.me.ts
import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { withFullstack } from '@loewen-digital/fullstack/adapters/remix'
import { auth } from '~/lib/stack.server'

export async function loader(args: LoaderFunctionArgs) {
  const { authSession } = await withFullstack(args, { auth })
  return json({ userId: authSession?.userId ?? null })
}
```

## Options

`createRemixLoader(stack, options)`, `createRemixAction(stack, options)` and `withFullstack(args, stack, options)` read these.

| Option | Default | Description |
|---|---|---|
| `sessionCookie` | `'fsid'` | Name of the session cookie: the session id with the memory and redis drivers, the signed payload with the cookie driver |
| `authCookie` | `'fs_token'` | Name of the auth cookie; `authCookieHeader` and `clearAuthCookieHeader` take the same option |
| `csrfExemptPaths` | `[]` | Path prefixes (`/api/webhooks`) that skip the CSRF check |

## Helpers

| Helper | Description |
|---|---|
| `authCookieHeader(token, { maxAge?, authCookie?, secure? })` | `Set-Cookie` value for the auth session token; `maxAge` in seconds, default 7 days; `secure` default `false` |
| `clearAuthCookieHeader({ authCookie? })` | `Set-Cookie` value that deletes it |
| `getCsrfToken({ session }, security)` | A CSRF token bound to the session's id, for a hidden field |
| `validateBody(request, session, rules)` | `{ ok: true, data }` or `{ ok: false, errors }`; on failure flashes `_errors` and the old input to `session` |
