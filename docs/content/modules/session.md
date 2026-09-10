---
title: Session
description: HTTP session management with flash messages, old input, and swappable drivers
---

# Session

The `session` module provides HTTP session management, flash messages, and old input persistence. It is independent of the `auth` module: login state lives in `auth`'s own sessions, this module carries request-to-request state such as flash messages.

Running next to `auth` on `@loewen-digital/flatdb`, locally and on Cloudflare Workers: see [Auth on flatdb](/guides/auth-on-flatdb). On the cookie driver the whole session travels in the signed cookie; the SvelteKit adapter's `createHandle` reads and writes it.

## Import

```ts
import { createSession } from '@loewen-digital/fullstack/session'
```

## Basic usage

```ts
import { createSession } from '@loewen-digital/fullstack/session'

const session = createSession({
  driver: 'cookie',
  secret: process.env.SESSION_SECRET!,
})

// Read the session from a request
const s = await session.get(request)

// Write a value
s.set('cart', [{ id: 1, qty: 2 }])

// Commit the session (returns a Response with Set-Cookie)
const response = await session.commit(s, new Response('OK'))
```

## Flash messages

Flash data is written for the current request and automatically cleared after the next read:

```ts
s.flash('success', 'Your profile has been updated.')

// On the next request:
const message = s.getFlash('success') // 'Your profile has been updated.'
// Subsequent requests return undefined
```

## Old input

Preserve form input across a failed submission:

```ts
// On form submission failure:
s.flashInput(Object.fromEntries(formData))

// On the next page load:
const old = s.oldInput('email') // previously submitted email
```

## Driver options

| Driver | Description |
|---|---|
| `cookie` | Signed cookie (HMAC-SHA256), not encrypted: readable by the client, tamper-proof. No server storage. About 4 KB; keep secrets out of it. |
| `memory` | In-process map. Useful for tests and simple use cases. |
| `redis` | Stores session data in Redis. Suitable for multi-instance deployments. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'cookie' \| 'memory' \| 'redis'` | `'cookie'` | Storage driver |
| `secret` | `string` | — | Signing secret (cookie driver) |
| `ttl` | `number` | `86400` | Session lifetime in seconds |
| `cookie.name` | `string` | `'session'` | Cookie name |
| `cookie.secure` | `boolean` | `true` | Set Secure flag on cookie |
| `cookie.sameSite` | `'lax' \| 'strict' \| 'none'` | `'lax'` | SameSite cookie attribute |
| `redis.url` | `string` | — | Redis connection URL |
