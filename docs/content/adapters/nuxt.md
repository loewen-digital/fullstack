---
title: Nuxt Adapter
description: createNuxtMiddleware wires session, auth and CSRF into Nitro's event context
---

# Nuxt Adapter

`createNuxtMiddleware(stack)` returns an h3 event handler for Nitro's `server/middleware/`. Per request it opens the session from its cookie, validates the auth cookie, checks the CSRF header on mutating requests, fills `event.context`, and writes the session cookie when its value changed. `setAuthCookie`, `clearAuthCookie`, `getCsrfToken` and `validateBody` cover login, logout and forms.

The adapter imports nothing from h3 or Nitro: it types the slice of the event it reads (`node.req`, `node.res`, `context`, `path`, `method`) and works on any h3 event structurally.

## Import

```ts
import { createNuxtMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
```

## Setup

### 1. Build the stack

`createNuxtMiddleware` takes any object with `session`, `auth` and `security`; each is optional and only the present modules run.

```ts
// server/lib/stack.ts
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'
import { createSession } from '@loewen-digital/fullstack/session'
import { createSecurity } from '@loewen-digital/fullstack/security'

export declare const authDb: AuthDbAdapter // yours, or createFlatdbAuthAdapter(...) from the guide

export const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: process.env.SESSION_SECRET! })
export const security = createSecurity({ csrf: { secret: process.env.CSRF_SECRET! } })
```

### 2. Register the middleware

Nitro runs every file in `server/middleware/` on every request.

```ts
// server/middleware/fullstack.ts
import { defineEventHandler } from 'h3'
import { createNuxtMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
import { auth, session, security } from '../lib/stack'

export default defineEventHandler(createNuxtMiddleware({ auth, session, security }))
```

### 3. Type `event.context`

`FullstackNuxtContext` declares everything the middleware sets, all optional because each depends on a module. Merge it into h3's context type once:

```ts
// server/fullstack.d.ts
import type { FullstackNuxtContext } from '@loewen-digital/fullstack/adapters/nuxt'

declare module 'h3' {
  interface H3EventContext extends FullstackNuxtContext {}
}
```

## What the middleware puts on `event.context`

| Property | Type | Set when |
|---|---|---|
| `session` | `SessionHandle` | the stack has `session`. Flash, old input, values; committed at the end of the middleware, cookie written when its value changed |
| `authSession` | `AuthSession \| null` | the stack has `auth`. The validated session behind the auth cookie, or `null` |
| `user` | `AuthUser \| null` | the stack has `auth`. Carries only `id` (`email` is empty): the adapter has no user store. Load the user yourself by `authSession.userId` |
| `csrfVerified` | `boolean` | the stack has `security` and the method is not GET, HEAD or OPTIONS. See [CSRF](#csrf) |

The session is committed when the middleware returns, before the route handler runs. Values a handler sets afterwards are saved on the next request that goes through the middleware, so flash a message in the handler that redirects and read it after the redirect.

## Guarding a route

```ts
// server/api/me.get.ts
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler((event) => {
  const authSession = event.context.authSession
  if (!authSession) throw createError({ statusCode: 401, message: 'Unauthorized' })

  return { userId: authSession.userId }
})
```

## Login and logout

`validateBody(event, rules)` reads the JSON or form body from the Node request, validates it with the [validation](/modules/validation) rules, and on failure flashes the errors as `_errors` and the input as old input. `setAuthCookie` stores the session token `httpOnly`, `SameSite=Lax`, for `maxAge` seconds (default 7 days). Nitro can sit behind a proxy, so the adapter does not guess the scheme: pass `secure: true` where the site is served over HTTPS.

```ts
// server/api/login.post.ts
import { defineEventHandler, createError } from 'h3'
import { setAuthCookie, validateBody } from '@loewen-digital/fullstack/adapters/nuxt'
import { auth, authDb } from '../lib/stack'

export default defineEventHandler(async (event) => {
  const result = await validateBody(event, { email: 'required|email', password: 'required|string' })
  if (!result.ok) throw createError({ statusCode: 422, data: result.errors })

  const { email, password } = result.data as { email: string; password: string }
  const user = await authDb.findUserByEmail(email)
  if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  const authSession = await auth.createSession(user)
  setAuthCookie(event, authSession.token, { secure: process.env.NODE_ENV === 'production' })
  return { userId: user.id }
})
```

```ts
// server/api/logout.post.ts
import { defineEventHandler } from 'h3'
import { clearAuthCookie } from '@loewen-digital/fullstack/adapters/nuxt'
import { auth } from '../lib/stack'

export default defineEventHandler(async (event) => {
  if (event.context.authSession) await auth.destroySession(event.context.authSession.token)
  clearAuthCookie(event)
  return { ok: true }
})
```

## CSRF

With a `security` module in the stack, the middleware checks every request whose method is not GET, HEAD or OPTIONS: the token in the `x-csrf-token` (or `x-xsrf-token`) header has to match the session id, and the result lands in `event.context.csrfVerified`. The middleware does not block the request; your handler decides. Paths that start with one of `csrfExemptPaths` skip the check (webhooks).

Hand the token to the client from a GET route; fetch calls send it back in the header.

```ts
// server/api/csrf.get.ts
import { defineEventHandler } from 'h3'
import { getCsrfToken } from '@loewen-digital/fullstack/adapters/nuxt'
import { security } from '../lib/stack'

export default defineEventHandler(async (event) => {
  return { token: await getCsrfToken(event.context, security) }
})
```

```ts
// server/api/profile.put.ts
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler((event) => {
  if (!event.context.csrfVerified) throw createError({ statusCode: 403, message: 'Invalid CSRF token' })
  return { saved: true }
})
```

## Options

`createNuxtMiddleware(stack, options)` reads these.

| Option | Default | Description |
|---|---|---|
| `sessionCookie` | `'fsid'` | Name of the session cookie: the session id with the memory and redis drivers, the signed payload with the cookie driver |
| `authCookie` | `'fs_token'` | Name of the auth cookie; `setAuthCookie` and `clearAuthCookie` take the same option |
| `csrfExemptPaths` | `[]` | Path prefixes (`/api/webhooks`) that skip the CSRF check |

The session cookie the middleware writes is `httpOnly`, `SameSite=Lax`, `Path=/`, without `Secure`.

## Helpers

| Helper | Description |
|---|---|
| `setAuthCookie(event, token, { maxAge?, authCookie?, secure? })` | Stores the auth session token; `maxAge` in seconds, default 7 days; `secure` default `false` |
| `clearAuthCookie(event, { authCookie? })` | Deletes it on logout |
| `getCsrfToken(context, security)` | A CSRF token bound to `context.session`'s id, for the client to send back |
| `validateBody(event, rules)` | `{ ok: true, data }` or `{ ok: false, errors }` from the JSON or form body; on failure flashes `_errors` and the old input to `context.session` |
