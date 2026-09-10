---
title: Auth on flatdb
description: Run the auth module on @loewen-digital/flatdb collections with the session module on the cookie driver, locally and on Cloudflare Workers
---

# Auth on flatdb

This guide wires `auth` to [`@loewen-digital/flatdb`](https://github.com/loewen-digital/flatdb) and puts the `session` module on the cookie driver. It is the setup `sveltekit-ai-starter-template` uses: JSON documents in a folder locally, in an R2 bucket on Cloudflare Workers, no SQL database.

Where things live:

| | Storage | Holds |
|---|---|---|
| `auth` | flatdb collections `users`, `sessions`, `tokens` | Login state: password hashes, server-side sessions, one-time tokens. Revocable by deleting the document. |
| `session` | signed cookie | Flash messages and old input. Nothing else, and nothing from it touches R2. |

Design and reasoning: [ADR 0001](https://github.com/loewen-digital/fullstack/blob/main/docs/adr/0001-flatdb-driver.md).

## Install

```bash
npm install @loewen-digital/flatdb zod
```

flatdb is an optional peer dependency of fullstack; `@loewen-digital/fullstack/auth/flatdb` imports nothing from it, so the version you install is the one you use. flatdb requires Node 24.

## Collections

`auth` needs three auto-mode collections. `users` is your own users collection with the auth fields added; `sessions` and `tokens` belong to `auth`. Dates are stored as ISO 8601 strings (JSON has no `Date`; ISO strings sort correctly under flatdb's `$lt`) and come back as `Date` from the adapter. flatdb strips fields a zod schema does not declare, so every schema declares what the adapter writes.

```ts
// src/lib/server/db.ts
import { flatdb, collection, type Collection, type StorageAdapter } from '@loewen-digital/flatdb'
import { z } from 'zod'

export const userSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  passwordHash: z.string().nullable().optional(),
  emailVerifiedAt: z.string().datetime().nullable().optional(),
})

const sessionSchema = z.object({
  userId: z.string(),
  token: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
})

const tokenSchema = z.object({
  userId: z.string(),
  token: z.string(),
  type: z.string(),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
})

export type UserDoc = z.infer<typeof userSchema>

export function createDb(adapter: StorageAdapter) {
  const db = flatdb(adapter, {
    users: collection(userSchema),
    sessions: collection(sessionSchema),
    tokens: collection(tokenSchema),
  })
  // UPSTREAM: https://github.com/loewen-digital/flatdb/issues/7 — flatdb types every
  // collection as `Collection | PathCollection`; auto-mode collections are cast here.
  return {
    users: db.users as Collection<UserDoc>,
    sessions: db.sessions as Collection,
    tokens: db.tokens as Collection,
  }
}

export type AppDb = ReturnType<typeof createDb>
```

Add your own fields to `userSchema` as you like; `auth` reads and writes only `email`, `passwordHash` and `emailVerifiedAt`. flatdb's `_id` is the user id `auth` sees. Every collection is a folder (`data/users/<id>.json`) plus an `_index.json` that holds all documents of the collection; on R2 the keys mirror that layout.

## Auth

`createFlatdbAuthAdapter` turns the three collections into the `AuthDbAdapter` that `createAuth` takes. Keep the adapter around as well: `findUserByEmail` returns the `AuthUser` a login needs. The auth cookie carries the opaque session token; its name and options live here so the hook, login and logout agree.

```ts
// src/lib/server/auth.ts
import { createAuth } from '@loewen-digital/fullstack/auth'
import { createFlatdbAuthAdapter } from '@loewen-digital/fullstack/auth/flatdb'
import type { AppDb } from './db'

const SESSION_TTL = 7 * 24 * 3600

export const AUTH_COOKIE = 'fs_token'

export function authCookieOptions(secure: boolean) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, maxAge: SESSION_TTL }
}

export function createAppAuth(db: AppDb) {
  const authDb = createFlatdbAuthAdapter(db)
  const auth = createAuth({ sessionTtl: SESSION_TTL }, { db: authDb })
  return { authDb, auth }
}
```

Both factories hold no state and cost nothing to create, which matters below: on Workers they are built per request.

## Session on the cookie driver

The cookie driver signs the session payload with HMAC-SHA256 and stores it in the cookie. Its limits:

- **About 4 KB.** Browsers drop larger cookies, and the session then comes back empty. Flash messages and a form's old input fit; a long textarea may not.
- **Signed, not encrypted.** Anyone with the cookie can read its JSON. Nothing secret goes in: no tokens, no password hashes, no personal data you would not show the user.
- **The login state is not in it.** Who is logged in is the `fs_token` cookie plus the session document in `sessions`, validated on every request by the hook below. The flash cookie can be lost or cleared without logging anyone out.

`createHandle` keeps only a session id in its cookie and reads the data from the driver's memory, so through it the cookie driver behaves like the memory driver: per process, per isolate on Workers. Until [#6](https://github.com/loewen-digital/fullstack/issues/6) lands, the app round-trips the payload itself:

```ts
// src/lib/server/session.ts
import { createCookieDriver, createSessionManager } from '@loewen-digital/fullstack/session'
import type { Cookies } from '@sveltejs/kit'

// UPSTREAM: https://github.com/loewen-digital/fullstack/issues/6 — createHandle stores only
// the session id in its cookie and keeps the cookie driver's data in memory. Until it
// serializes the payload itself, the app seeds the driver from the cookie and writes it back.
export async function loadCookieSession(secret: string, cookies: Cookies, name = 'session') {
  const driver = createCookieDriver(secret)
  const manager = createSessionManager(driver)
  const id = driver.generateId()
  await driver.write(id, await driver.parse(cookies.get(name) ?? ''))
  const session = await manager.load(id)
  return {
    session,
    async commit(secure: boolean) {
      await session.save()
      const value = await driver.serialize(await driver.read(session.id))
      cookies.set(name, value, { path: '/', httpOnly: true, sameSite: 'lax', secure })
    },
  }
}
```

A tampered cookie fails the signature check and yields an empty session. The secret comes from `SESSION_SECRET`: a Workers secret in production (`wrangler secret put SESSION_SECRET`), `.env` locally.

## Wiring it in SvelteKit

Everything is built inside the request. flatdb caches a collection's index in memory and refreshes it only on its own writes, so a module-level database serves stale reads on Workers as soon as another isolate has written. The auth factories and the cookie session follow the same rule because they are free to build and the session's data comes from the cookie, not from memory.

The hook validates the auth cookie itself. `createHandle`, `setAuthCookie` and `clearAuthCookie` from the SvelteKit adapter do not accept SvelteKit's `RequestEvent` type yet ([#8](https://github.com/loewen-digital/fullstack/issues/8)); what they do is three lines each.

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { FsAdapter, R2Adapter } from '@loewen-digital/flatdb'
import { createDb } from '$lib/server/db'
import { AUTH_COOKIE, createAppAuth } from '$lib/server/auth'
import { loadCookieSession } from '$lib/server/session'

export const handle: Handle = async ({ event, resolve }) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set')

  const bucket = event.platform?.env.CONTENT
  const db = createDb(bucket ? new R2Adapter({ bucket, prefix: 'data' }) : new FsAdapter('./data'))
  const { authDb, auth } = createAppAuth(db)
  const { session, commit } = await loadCookieSession(env.SESSION_SECRET, event.cookies)

  // UPSTREAM: https://github.com/loewen-digital/fullstack/issues/8 — createHandle's event type
  // rejects SvelteKit's RequestEvent; the auth cookie is validated here instead.
  const token = event.cookies.get(AUTH_COOKIE)

  event.locals.db = db
  event.locals.authDb = authDb
  event.locals.auth = auth
  event.locals.session = session
  event.locals.authSession = token ? await auth.validateSession(token) : null

  const response = await resolve(event)
  await commit(event.url.protocol === 'https:')
  return response
}
```

```ts
// src/app.d.ts
import type { AuthDbAdapter, AuthInstance, AuthSession } from '@loewen-digital/fullstack/auth'
import type { SessionHandle } from '@loewen-digital/fullstack/session'
import type { AppDb } from '$lib/server/db'

declare global {
  namespace App {
    interface Locals {
      db: AppDb
      authDb: AuthDbAdapter
      auth: AuthInstance
      session: SessionHandle
      authSession: AuthSession | null
    }
    interface Platform {
      env: { CONTENT: R2Bucket }
    }
  }
}

export {}
```

`R2Bucket` comes from `@cloudflare/workers-types` (add it to `compilerOptions.types`). `locals.authSession` carries the user id; load the user from `locals.db.users` where you need more.

### Register and log in

```ts
// src/routes/login/+page.server.ts
import { fail, redirect } from '@sveltejs/kit'
import { AUTH_COOKIE, authCookieOptions } from '$lib/server/auth'
import type { Actions } from './$types'

export const actions: Actions = {
  register: async (event) => {
    const { auth, db } = event.locals
    const form = await event.request.formData()
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    if (await db.users.findOne({ email })) return fail(422, { error: 'Email already registered' })
    await db.users.insert({ email, passwordHash: await auth.hashPassword(password), emailVerifiedAt: null })
    redirect(303, '/login')
  },

  login: async (event) => {
    const { auth, authDb, session } = event.locals
    const form = await event.request.formData()
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    const user = await authDb.findUserByEmail(email)
    if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
      session.flashInput({ email })
      return fail(401, { error: 'Invalid credentials' })
    }

    const authSession = await auth.createSession(user)
    event.cookies.set(AUTH_COOKIE, authSession.token, authCookieOptions(event.url.protocol === 'https:'))
    session.flash('notice', 'Welcome back')
    redirect(303, '/dashboard')
  },
}
```

```ts
// src/routes/dashboard/+page.server.ts
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authSession) redirect(303, '/login')
  const user = await locals.db.users.findById(String(locals.authSession.userId))
  return { email: user?.email, name: user?.name, notice: locals.session.getFlash<string>('notice') }
}
```

Logout destroys the server-side session and clears its cookie; the flash session stays as it is:

```ts
// src/routes/logout/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { AUTH_COOKIE } from '$lib/server/auth'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async (event) => {
    const token = event.cookies.get(AUTH_COOKIE)
    if (token) await event.locals.auth.destroySession(token)
    event.cookies.delete(AUTH_COOKIE, { path: '/' })
    redirect(303, '/login')
  },
}
```

Email verification and password reset work unchanged: `auth.sendVerificationEmail(user, send)`, `auth.verifyEmail(token)`, `auth.sendPasswordResetEmail(user, send)`, `auth.resetPassword(token, password)`. The tokens land in `tokens`, used once, with `usedAt` set afterwards.

## Cloudflare Workers

```jsonc
// wrangler.jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "r2_buckets": [{ "binding": "CONTENT", "bucket_name": "my-app-content" }]
}
```

- **`nodejs_compat` is required** twice over: flatdb's entry exports `FsAdapter`, whose `node:fs` import has to resolve, and fullstack's `auth` uses `node:crypto` for scrypt and token generation.
- **`R2Adapter` takes the binding from `platform.env`**, as in the hook above. `prefix` namespaces all keys, so one bucket can hold the database next to other files.
- **One database per request.** Adapter, collections, `createFlatdbAuthAdapter`, `createAuth` and the cookie session are built inside `handle`, never at module level. Concurrent writes to a collection's index are safe: flatdb writes `_index.json` with a compare-and-swap on the etag and retries. Two requests updating the same document at once end last-writer-wins.
- `SESSION_SECRET` is a Workers secret; `$env/dynamic/private` reads it through `adapter-cloudflare`.

## Local development and tests

Locally the hook falls back to `FsAdapter('./data')`: readable JSON, one file per document, `data/users/<id>.json`. Commit the folder or ignore it, as suits the app. `SESSION_SECRET` comes from `.env`.

Tests use `MemoryAdapter` and never touch the filesystem. `createDb` and `createAppAuth` take the adapter, so a test builds the whole stack in two lines:

```ts
import { describe, it, expect } from 'vitest'
import { MemoryAdapter } from '@loewen-digital/flatdb'
import { createDb } from '$lib/server/db'
import { createAppAuth } from '$lib/server/auth'

describe('login', () => {
  it('verifies the password and creates a session', async () => {
    const db = createDb(new MemoryAdapter())
    const { auth, authDb } = createAppAuth(db)
    await db.users.insert({ email: 'a@example.com', passwordHash: await auth.hashPassword('secret') })

    const user = await authDb.findUserByEmail('a@example.com')
    expect(await auth.verifyPassword('secret', user!.passwordHash!)).toBe(true)
    const session = await auth.createSession(user!)
    expect(await auth.validateSession(session.token)).not.toBeNull()
  })
})
```

## Expired auth sessions

`auth.createSession` deletes the user's own expired sessions before it inserts the new one ([decision 0002](https://github.com/loewen-digital/fullstack/blob/main/docs/decisions/0002-expired-sessions-on-login.md)): one query per login, scoped to that user, no scheduled job needed for active users. `validateSession` deletes an expired session it comes across. fullstack runs no global sweep, so sessions of users who never return stay in the collection, as do used and expired one-time tokens.

If that matters, sweep them from a Worker with a Cron Trigger on the same bucket. `adapter-cloudflare` builds a fetch-only Worker, so this is a second, tiny Worker:

```ts
// cron/src/index.ts
import { flatdb, collection, R2Adapter, type Collection } from '@loewen-digital/flatdb'

export default {
  async scheduled(_event: ScheduledEvent, env: { CONTENT: R2Bucket }) {
    const db = flatdb(new R2Adapter({ bucket: env.CONTENT, prefix: 'data' }), {
      sessions: collection(),
      tokens: collection(),
    })
    const now = new Date().toISOString()
    await (db.sessions as Collection).delete({ expiresAt: { $lt: now } })
    await (db.tokens as Collection).delete({ expiresAt: { $lt: now } })
  },
}
```

```jsonc
// cron/wrangler.jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "r2_buckets": [{ "binding": "CONTENT", "bucket_name": "my-app-content" }],
  "triggers": { "crons": ["0 3 * * *"] }
}
```

Locally the same two `delete` calls run from any script against `FsAdapter('./data')`.
