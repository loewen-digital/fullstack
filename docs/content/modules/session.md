---
title: Session
description: Flash messages, old input and request-to-request state, in a signed cookie or a store
---

# Session

The `session` module carries state from one request to the next: flash messages, a form's old input, anything small you `set`. It is independent of `auth`: login state lives in `auth`'s own sessions, this module never sees a password or a token.

Running next to `auth` on `@loewen-digital/flatdb`, locally and on Cloudflare Workers: see [Auth on flatdb](/guides/auth-on-flatdb). In SvelteKit, `createHandle` from the [adapter](/adapters/sveltekit) runs the request cycle below for you and puts the handle on `locals.session`.

## Import

```ts
import { createSession } from '@loewen-digital/fullstack/session'
```

## Request cycle

`createSession(config)` builds a manager once. Per request, `open(cookie)` turns the session cookie's value into a handle, and `commit(handle)` saves the handle and returns the value the response cookie has to carry. Set the cookie when that value differs from the one the request brought. What the value is depends on the driver: the session id with `memory` and `redis`, the signed payload with `cookie`.

```ts
import { createSession } from '@loewen-digital/fullstack/session'

const session = createSession({ driver: 'cookie', secret: process.env.SESSION_SECRET! })

async function handle(request: Request): Promise<Response> {
  const cookie = /(?:^|;\s*)fsid=([^;]*)/.exec(request.headers.get('cookie') ?? '')?.[1]
  const s = await session.open(cookie)

  s.set('cart', [{ id: 1, qty: 2 }])
  const cart = s.get<{ id: number; qty: number }[]>('cart')

  const response = new Response(JSON.stringify({ cart }), { headers: { 'content-type': 'application/json' } })
  const value = await session.commit(s)
  if (value !== cookie) {
    response.headers.append('set-cookie', `fsid=${value}; Path=/; HttpOnly; SameSite=Lax; Secure`)
  }
  return response
}
```

## The handle

```ts
import type { SessionHandle } from '@loewen-digital/fullstack/session'

async function afterLogin(s: SessionHandle) {
  s.set('userId', 42)
  s.get<number>('userId') // 42
  s.forget('userId')

  await s.regenerate() // new id, same data: call after login
}

async function afterLogout(s: SessionHandle) {
  await s.destroy() // no data, gone from the store; commit() then writes an empty session
}
```

## Flash messages

A flash value is written in this request, readable in the next, and gone after that.

```ts
function saveProfile(s: SessionHandle) {
  s.flash('success', 'Your profile has been updated.')
}

function renderProfile(s: SessionHandle) {
  return s.getFlash<string>('success') // 'Your profile has been updated.' once, then undefined
}
```

## Old input

Keep what the user typed across a failed submission and fill the form again from it.

```ts
function rejectForm(s: SessionHandle, form: FormData) {
  s.flashInput(Object.fromEntries(form))
}

function renderForm(s: SessionHandle) {
  return { email: s.getOldInput<string>('email') ?? '' }
}
```

## Drivers

| Driver | Description |
|---|---|
| `cookie` | Stateless: the whole session travels in the cookie, signed with HMAC-SHA256 and `secret`. Not encrypted: the client can read it, so keep secrets out. About 4 KB fits; a tampered or expired cookie opens an empty session. |
| `memory` | In-process map with `maxAge` expiry. Tests and single-process development. |
| `redis` | One key per session in Redis, `maxAge` as the key's TTL. Multi-instance deployments. |

Redis needs a client, so it goes through the low-level factory. Any object with `get`, `set(key, value, 'EX', seconds)` and `del` works, `ioredis` and `redis` v4 included.

```ts
import { createRedisDriver, createSessionManager, type RedisClient } from '@loewen-digital/fullstack/session'

declare const redis: RedisClient // a connected ioredis or redis v4 client

const redisSession = createSessionManager(createRedisDriver(redis, { ttl: 3600, prefix: 'session:' }), 3600)
```

`createSessionManager(driver, ttlSeconds)` also takes your own `SessionDriver`: `read`, `write`, `destroy` and `generateId`, plus `serialize` and `parse` for a stateless one.

## Config options

`createSession(config)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'cookie' \| 'memory' \| 'redis'` | — | Storage driver (required). `redis` throws here: build it with `createRedisDriver` as above. |
| `secret` | `string` | — | Signs the cookie; required with `cookie` |
| `maxAge` | `string` | `'2h'` | Lifetime, as `'30m'`, `'2h'`, `'7d'` or seconds: the payload's expiry with `cookie`, the entry's TTL with `memory` and `redis` |

The cookie's attributes are the adapter's business: `createHandle` names it with `sessionCookie` (default `fsid`) and sets `Path=/`, `HttpOnly`, `SameSite=Lax` and `Secure` on HTTPS. It sets no `Max-Age`, so the browser drops the cookie when it closes; the payload expires after `maxAge` regardless.
