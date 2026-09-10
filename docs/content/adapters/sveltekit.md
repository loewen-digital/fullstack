---
title: SvelteKit Adapter
description: createHandle wires session, auth and CSRF into SvelteKit's hooks and locals
---

# SvelteKit Adapter

`createHandle(stack)` returns a SvelteKit `Handle`. Per request it opens the session from its cookie, validates the auth cookie, checks the CSRF header on mutating requests, fills `event.locals`, and writes the session cookie after the response. `setAuthCookie`, `clearAuthCookie`, `getCsrfToken` and `validateForm` cover login, logout and forms.

The [Auth on flatdb](/guides/auth-on-flatdb) guide shows this wiring with `@loewen-digital/flatdb` as storage, built per request for Cloudflare Workers.

## Import

```ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
```

## Setup

### 1. Build the stack

`createHandle` takes any object with `session`, `auth` and `security`; each is optional and only the present modules run.

```ts
// src/lib/server/stack.ts
import { env } from '$env/dynamic/private'
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'
import { createSession } from '@loewen-digital/fullstack/session'
import { createSecurity } from '@loewen-digital/fullstack/security'

export declare const authDb: AuthDbAdapter // yours, or createFlatdbAuthAdapter(...) from the guide

export const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: env.SESSION_SECRET! })
export const security = createSecurity({ csrf: { secret: env.CSRF_SECRET! } })
```

### 2. Add the handle hook

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, session, security } from '$lib/server/stack.js'

export const handle = createHandle({ auth, session, security })
```

With other hooks, `sequence` from SvelteKit takes it like any `Handle`:

```ts
import type { Handle } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, session, security } from '$lib/server/stack.js'

const logRequests: Handle = ({ event, resolve }) => {
  console.log(event.request.method, event.url.pathname)
  return resolve(event)
}

export const handle = sequence(createHandle({ auth, session, security }), logRequests)
```

### 3. Type `App.Locals`

`FullstackLocals` declares everything the handle sets, all optional because each depends on a module. Make required what your stack always provides.

```ts
// src/app.d.ts
import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'
import type { SessionHandle } from '@loewen-digital/fullstack/session'

declare global {
  namespace App {
    interface Locals extends FullstackLocals {
      session: SessionHandle // the stack has a session module, so it is always there
    }
  }
}

export {}
```

## What the handle puts on `locals`

| Property | Type | Set when |
|---|---|---|
| `session` | `SessionHandle` | the stack has `session`. Flash, old input, values; committed after the response, cookie written when its value changed |
| `authSession` | `AuthSession \| null` | the stack has `auth`. The validated session behind the auth cookie, or `null` |
| `user` | `AuthUser \| null` | the stack has `auth`. Carries only `id` (`email` is empty): the adapter has no user store. Load the user yourself by `authSession.userId` |
| `csrfVerified` | `boolean` | the stack has `security` and the method is not GET, HEAD or OPTIONS. See [CSRF](#csrf) |

## Guarding a page

```ts
// src/routes/dashboard/+page.server.ts
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authSession) redirect(302, '/login')

  return {
    userId: locals.authSession.userId,
    notice: locals.session.getFlash<string>('notice'),
  }
}
```

## Login and logout

`validateForm(request, session, rules)` parses JSON or form data, validates it with the [validation](/modules/validation) rules, and on failure flashes the errors as `_errors` and the input as old input. `setAuthCookie` stores the session token `httpOnly`, `SameSite=Lax`, `Secure` on HTTPS, for `maxAge` seconds (default 7 days).

```ts
// src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit'
import { setAuthCookie, validateForm } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, authDb } from '$lib/server/stack.js'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async (event) => {
    const result = await validateForm(event.request, event.locals.session, {
      email: 'required|email',
      password: 'required|string',
    })
    if (!result.ok) return fail(422, { errors: result.errors })

    const { email, password } = result.data as { email: string; password: string }
    const user = await authDb.findUserByEmail(email)
    if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
      event.locals.session.flashInput({ email })
      return fail(401, { error: 'Invalid credentials' })
    }

    const authSession = await auth.createSession(user)
    setAuthCookie(event, authSession.token, { maxAge: 7 * 24 * 3600 })
    event.locals.session.flash('notice', 'Welcome back')
    redirect(303, '/dashboard')
  },
}
```

```ts
// src/routes/logout/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { clearAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth } from '$lib/server/stack.js'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async (event) => {
    if (event.locals.authSession) await auth.destroySession(event.locals.authSession.token)
    clearAuthCookie(event)
    redirect(303, '/login')
  },
}
```

## CSRF

With a `security` module in the stack, the handle checks every request whose method is not GET, HEAD or OPTIONS: the token in the `x-csrf-token` (or `x-xsrf-token`) header has to match the session id, and the result lands in `locals.csrfVerified`. The handle does not block the request; your action decides. Route ids listed in `csrfExempt` skip the check (webhooks).

Fetch clients send the header. An HTML form carries the token in a hidden field instead, so the action verifies it itself:

```ts
// src/routes/profile/+page.server.ts
import { fail } from '@sveltejs/kit'
import { getCsrfToken } from '@loewen-digital/fullstack/adapters/sveltekit'
import { security } from '$lib/server/stack.js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  return { csrf: await getCsrfToken(locals, security) } // <input type="hidden" name="_csrf" value={data.csrf}>
}

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const form = await request.formData()
    if (!(await security.verifyCsrfToken(locals.session.id, String(form.get('_csrf'))))) {
      return fail(403, { error: 'Invalid CSRF token' })
    }
    return { saved: true }
  },
}
```

## Options

`createHandle(stack, options)` reads these.

| Option | Default | Description |
|---|---|---|
| `sessionCookie` | `'fsid'` | Name of the session cookie: the session id with the memory and redis drivers, the signed payload with the cookie driver |
| `authCookie` | `'fs_token'` | Name of the auth cookie; `setAuthCookie` and `clearAuthCookie` take the same option |
| `csrfExempt` | `[]` | Route ids (`event.route.id`, such as `/api/webhooks/stripe`) that skip the CSRF check |

## Helpers

| Helper | Description |
|---|---|
| `setAuthCookie(event, token, { maxAge?, authCookie? })` | Stores the auth session token; `maxAge` in seconds, default 7 days |
| `clearAuthCookie(event, { authCookie? })` | Deletes it on logout |
| `getCsrfToken(locals, security)` | A CSRF token bound to `locals.session`'s id, for a hidden field |
| `validateForm(request, session, rules)` | `{ ok: true, data }` or `{ ok: false, errors }`; on failure flashes `_errors` and the old input to `session` |
