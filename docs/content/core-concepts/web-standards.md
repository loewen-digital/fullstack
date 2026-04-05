---
title: Web Standards First
description: Why @loewen-digital/fullstack uses Web Platform APIs instead of Node.js-specific abstractions
---

# Web Standards First

`@loewen-digital/fullstack` is built on Web Platform APIs — the same APIs available in browsers, Deno, Bun, Cloudflare Workers, and Node.js 18+. This is not a stylistic choice; it is what makes the library genuinely framework-agnostic.

## The APIs we use

| Web Standard | Used for |
|---|---|
| `Request` | Incoming HTTP requests in all modules |
| `Response` | Outgoing HTTP responses |
| `Headers` | HTTP headers manipulation |
| `URL` / `URLSearchParams` | URL parsing and query strings |
| `FormData` | Form input parsing |
| `ReadableStream` | Streaming file data |
| `Uint8Array` | Binary data (instead of `Buffer`) |
| `crypto.subtle` | Password hashing, token generation, HMAC |
| `fetch` | Outgoing HTTP calls in drivers |

## Why not Node.js APIs?

Node.js has its own HTTP abstractions (`IncomingMessage`, `ServerResponse`, `Buffer`, `node:http`). These work fine in Node, but they don't exist in Deno, Bun, or Cloudflare Workers. By building on Web Standards, your application code is portable across all these runtimes.

Modern meta-frameworks (SvelteKit, Remix, Astro, Nuxt Nitro) already expose Web Standard `Request` and `Response` objects in their server handlers. This means our adapters are thin — often just a few lines.

## Concrete example: reading a request

Instead of:

```ts
// Node.js style — does not work in Deno or Workers
import type { IncomingMessage } from 'node:http'

function getBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
  })
}
```

We use:

```ts
// Web Standard — works everywhere
async function getBody(req: Request): Promise<string> {
  return req.text()
}
```

## `Uint8Array` instead of `Buffer`

`Buffer` is a Node.js class that extends `Uint8Array`. We use plain `Uint8Array` so that code runs on all runtimes:

```ts
// We do this:
const bytes: Uint8Array = await crypto.subtle.digest('SHA-256', data)

// Not this:
const hash = crypto.createHash('sha256').update(data).digest() // Buffer
```

## `crypto.subtle` for cryptography

All cryptographic operations — password hashing, token signing, HMAC verification — use `crypto.subtle`, which is part of the Web Crypto API and available in every modern runtime:

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'

// Under the hood, auth uses crypto.subtle.importKey + crypto.subtle.deriveBits
// for Argon2id-style password hashing — no native addons required
```

## Runtime compatibility

| API | Node 20+ | Deno | Bun | CF Workers |
|---|---|---|---|---|
| `Request` / `Response` | Yes | Yes | Yes | Yes |
| `Headers` | Yes | Yes | Yes | Yes |
| `FormData` | Yes | Yes | Yes | Yes |
| `ReadableStream` | Yes | Yes | Yes | Yes |
| `crypto.subtle` | Yes | Yes | Yes | Yes |
| `fetch` | Yes | Yes | Yes | Yes |
| `Uint8Array` | Yes | Yes | Yes | Yes |

## Framework adapter example

Because we use `Request`, the SvelteKit adapter is trivial:

```ts
// src/adapters/sveltekit/index.ts
import type { Handle } from '@sveltejs/kit'
import type { AuthInstance } from '@loewen-digital/fullstack/auth'

export function createHandle(auth: AuthInstance): Handle {
  return async ({ event, resolve }) => {
    // event.request is already a Web Standard Request
    event.locals.user = await auth.user(event.request)
    return resolve(event)
  }
}
```

No conversion or wrapping needed — the framework already speaks the same language.
