---
title: Quick Start
description: Register, log in and guard a page in SvelteKit with auth, session and validation
---

# Quick Start

This page builds a login in SvelteKit: users in JSON files through [`@loewen-digital/flatdb`](https://github.com/loewen-digital/flatdb), password hashing and server-side sessions from `auth`, flash messages from `session`, form validation from `validation`, all wired by the [SvelteKit adapter](/adapters/sveltekit). Everything runs in one Node process on local files; the [Auth on flatdb](/guides/auth-on-flatdb) guide takes the same setup to Cloudflare Workers.

`auth` stores nothing itself. It takes an `AuthDbAdapter`, and `@loewen-digital/fullstack/auth/flatdb` ships one for flatdb collections; on another store you implement the [eleven methods](/modules/auth#the-adapter) yourself.

## 1. Install

```bash
npm install @loewen-digital/fullstack @loewen-digital/flatdb zod
```

Put a secret for the session cookie into `.env`:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
```

## 2. Collections

`auth` needs three collections: your `users` with `email`, `passwordHash` and `emailVerifiedAt`, plus `sessions` and `tokens` that belong to `auth`. flatdb strips fields a schema does not declare, so the users schema declares the auth fields; `sessions` and `tokens` go without a schema.

```ts
// src/lib/server/db.ts
import { flatdb, collection, FsAdapter, type Collection } from '@loewen-digital/flatdb'
import { z } from 'zod'

const userSchema = z.object({
  email: z.string().email(),
  passwordHash: z.string().nullable().optional(),
  emailVerifiedAt: z.string().datetime().nullable().optional(),
})

const db = flatdb(new FsAdapter('./data'), {
  users: collection(userSchema),
  sessions: collection(),
  tokens: collection(),
})

export const users = db.users as Collection<z.infer<typeof userSchema>>
export const sessions = db.sessions as Collection
export const tokens = db.tokens as Collection
```

## 3. Auth and session

`createAuth(config, { db })` takes the adapter; every option has a default. The session module on the cookie driver carries flash messages and old input in a signed cookie.

```ts
// src/lib/server/stack.ts
import { env } from '$env/dynamic/private'
import { createAuth } from '@loewen-digital/fullstack/auth'
import { createFlatdbAuthAdapter } from '@loewen-digital/fullstack/auth/flatdb'
import { createSession } from '@loewen-digital/fullstack/session'
import { users, sessions, tokens } from './db'

export const authDb = createFlatdbAuthAdapter({ users, sessions, tokens })
export const auth = createAuth({}, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: env.SESSION_SECRET! })
```

## 4. The hook

`createHandle` opens the session from its cookie, validates the auth cookie and fills `event.locals` on every request.

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, session } from '$lib/server/stack'

export const handle = createHandle({ auth, session })
```

```ts
// src/app.d.ts
import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'
import type { SessionHandle } from '@loewen-digital/fullstack/session'

declare global {
  namespace App {
    interface Locals extends FullstackLocals {
      session: SessionHandle
    }
  }
}

export {}
```

## 5. Register and log in

`validateForm` parses the form, validates it against pipe-string rules and, when it fails, flashes the errors and the old input into the session. Registration hashes the password and stores the user; login verifies the hash, opens an auth session and puts its token into the `httpOnly` auth cookie.

```ts
// src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit'
import { setAuthCookie, validateForm } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, authDb } from '$lib/server/stack'
import { users } from '$lib/server/db'
import type { Actions } from './$types'

const rules = { email: 'required|email', password: 'required|string|min:8' }

export const actions: Actions = {
  register: async (event) => {
    const result = await validateForm(event.request, event.locals.session, rules)
    if (!result.ok) return fail(422, { errors: result.errors })

    const { email, password } = result.data as { email: string; password: string }
    if (await users.findOne({ email })) return fail(422, { error: 'Email already registered' })

    await users.insert({ email, passwordHash: await auth.hashPassword(password), emailVerifiedAt: null })
    event.locals.session.flash('notice', 'Account created, please log in')
    redirect(303, '/login')
  },

  login: async (event) => {
    const result = await validateForm(event.request, event.locals.session, rules)
    if (!result.ok) return fail(422, { errors: result.errors })

    const { email, password } = result.data as { email: string; password: string }
    const user = await authDb.findUserByEmail(email)
    if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
      event.locals.session.flashInput({ email })
      return fail(401, { error: 'Invalid credentials' })
    }

    const authSession = await auth.createSession(user)
    setAuthCookie(event, authSession.token)
    redirect(303, '/dashboard')
  },
}
```

## 6. Guard a page

`locals.authSession` is the validated session behind the auth cookie, or `null`. It carries the user id; the user record is one lookup away.

```ts
// src/routes/dashboard/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { users } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authSession) redirect(303, '/login')

  const user = await users.findById(String(locals.authSession.userId))
  return { email: user?.email, notice: locals.session.getFlash<string>('notice') }
}
```

## 7. Log out

```ts
// src/routes/logout/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { clearAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth } from '$lib/server/stack'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async (event) => {
    if (event.locals.authSession) await auth.destroySession(event.locals.authSession.token)
    clearAuthCookie(event)
    redirect(303, '/login')
  },
}
```

## What's next

- [Validation](/modules/validation) for the rules `validateForm` understands
- [Auth](/modules/auth) for email verification, password reset and OAuth
- [Session](/modules/session) for flash, old input and the cookie driver's limits
- [Auth on flatdb](/guides/auth-on-flatdb) for the same setup on Cloudflare Workers
