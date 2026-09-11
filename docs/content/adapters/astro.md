---
title: Astro Adapter
description: createAstroMiddleware wires session, auth and CSRF into Astro.locals
---

# Astro Adapter

`createAstroMiddleware(stack)` returns an Astro middleware. Per request it opens the session from its cookie, validates the auth cookie, checks the CSRF header on mutating requests, fills `context.locals`, runs the route, and writes the session cookie after the response when its value changed. `setAuthCookie`, `clearAuthCookie`, `getCsrfToken` and `validateBody` cover login, logout and forms.

Astro hands its middleware and endpoints a Web Standard `Request` and expects a `Response`, so nothing is converted. The adapter imports nothing from Astro; it types the slice of the context it reads (`request`, `url`, `cookies`, `locals`).

## Import

```ts
import { createAstroMiddleware } from '@loewen-digital/fullstack/adapters/astro'
```

## Setup

### 1. Render on the server

Middleware and endpoints need a server adapter and `output: 'server'` (or per-route `prerender = false`) in `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
})
```

### 2. Build the stack

`createAstroMiddleware` takes any object with `session`, `auth` and `security`; each is optional and only the present modules run.

```ts
// src/lib/stack.ts
import { getSecret } from 'astro:env/server'
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'
import { createSession } from '@loewen-digital/fullstack/session'
import { createSecurity } from '@loewen-digital/fullstack/security'

export declare const authDb: AuthDbAdapter // yours, or createFlatdbAuthAdapter(...) from the guide

export const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: getSecret('SESSION_SECRET')! })
export const security = createSecurity({ csrf: { secret: getSecret('CSRF_SECRET')! } })
```

### 3. Add the middleware

```ts
// src/middleware.ts
import { sequence } from 'astro:middleware'
import { createAstroMiddleware } from '@loewen-digital/fullstack/adapters/astro'
import { auth, session, security } from './lib/stack'

export const onRequest = sequence(createAstroMiddleware({ auth, session, security }))
```

### 4. Type `App.Locals`

`FullstackAstroLocals` declares everything the middleware sets, all optional because each depends on a module.

```ts
// src/env.d.ts
import type { FullstackAstroLocals } from '@loewen-digital/fullstack/adapters/astro'

declare global {
  namespace App {
    interface Locals extends FullstackAstroLocals {}
  }
}

export {}
```

## What the middleware puts on `locals`

| Property | Type | Set when |
|---|---|---|
| `session` | `SessionHandle` | the stack has `session`. Flash, old input, values; committed after the response, cookie written when its value changed |
| `authSession` | `AuthSession \| null` | the stack has `auth`. The validated session behind the auth cookie, or `null` |
| `user` | `AuthUser \| null` | the stack has `auth`. Carries only `id` (`email` is empty): the adapter has no user store. Load the user yourself by `authSession.userId` |
| `csrfVerified` | `boolean` | the stack has `security` and the method is not GET, HEAD or OPTIONS. See [CSRF](#csrf) |

## Guarding a page

```astro
---
// src/pages/dashboard.astro
const { authSession, session } = Astro.locals
if (!authSession) return Astro.redirect('/login')

const notice = session?.getFlash<string>('notice')
---

<h1>Signed in as {authSession.userId}</h1>
{notice && <p>{notice}</p>}
```

And an endpoint:

```ts
// src/pages/api/me.ts
import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ locals }) => {
  if (!locals.authSession) return new Response('Unauthorized', { status: 401 })
  return Response.json({ userId: locals.authSession.userId })
}
```

## Login and logout

`validateBody(request, session, rules)` parses JSON or form data, validates it with the [validation](/modules/validation) rules, and on failure flashes the errors as `_errors` and the input as old input. `setAuthCookie` stores the session token `httpOnly`, `SameSite=Lax`, `Secure` on HTTPS, for `maxAge` seconds (default 7 days).

```ts
// src/pages/api/login.ts
import type { APIRoute } from 'astro'
import { setAuthCookie, validateBody } from '@loewen-digital/fullstack/adapters/astro'
import { auth, authDb } from '../../lib/stack'

export const POST: APIRoute = async (context) => {
  const { request, locals } = context
  const result = await validateBody(request, locals.session, { email: 'required|email', password: 'required|string' })
  if (!result.ok) return Response.json({ errors: result.errors }, { status: 422 })

  const { email, password } = result.data as { email: string; password: string }
  const user = await authDb.findUserByEmail(email)
  if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    locals.session?.flashInput({ email })
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const authSession = await auth.createSession(user)
  setAuthCookie(context, authSession.token)
  locals.session?.flash('notice', 'Welcome back')
  return context.redirect('/dashboard', 303)
}
```

```ts
// src/pages/api/logout.ts
import type { APIRoute } from 'astro'
import { clearAuthCookie } from '@loewen-digital/fullstack/adapters/astro'
import { auth } from '../../lib/stack'

export const POST: APIRoute = async (context) => {
  if (context.locals.authSession) await auth.destroySession(context.locals.authSession.token)
  clearAuthCookie(context)
  return context.redirect('/login', 303)
}
```

## CSRF

With a `security` module in the stack, the middleware checks every request whose method is not GET, HEAD or OPTIONS: the token in the `x-csrf-token` (or `x-xsrf-token`) header has to match the session id, and the result lands in `locals.csrfVerified`. The middleware does not block the request; your endpoint decides. Paths that start with one of `csrfExemptPaths` skip the check (webhooks).

Fetch clients send the header. An HTML form carries the token in a hidden field instead, so the endpoint verifies it itself:

```ts
// src/pages/api/profile.ts
import type { APIRoute } from 'astro'
import { getCsrfToken } from '@loewen-digital/fullstack/adapters/astro'
import { security } from '../../lib/stack'

export const GET: APIRoute = async ({ locals }) => {
  return Response.json({ csrf: await getCsrfToken(locals, security) }) // <input type="hidden" name="_csrf" value={csrf}>
}

export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData()
  const sessionId = locals.session?.id ?? ''
  if (!(await security.verifyCsrfToken(sessionId, String(form.get('_csrf'))))) {
    return Response.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }
  return Response.json({ saved: true })
}
```

## Options

`createAstroMiddleware(stack, options)` reads these.

| Option | Default | Description |
|---|---|---|
| `sessionCookie` | `'fsid'` | Name of the session cookie: the session id with the memory and redis drivers, the signed payload with the cookie driver |
| `authCookie` | `'fs_token'` | Name of the auth cookie; `setAuthCookie` and `clearAuthCookie` take the same option |
| `csrfExemptPaths` | `[]` | Path prefixes (`/api/webhooks`) that skip the CSRF check |

## Helpers

| Helper | Description |
|---|---|
| `setAuthCookie(context, token, { maxAge?, authCookie? })` | Stores the auth session token; `maxAge` in seconds, default 7 days |
| `clearAuthCookie(context, { authCookie? })` | Deletes it on logout |
| `getCsrfToken(locals, security)` | A CSRF token bound to `locals.session`'s id, for a hidden field |
| `validateBody(request, session, rules)` | `{ ok: true, data }` or `{ ok: false, errors }`; on failure flashes `_errors` and the old input to `session` |
