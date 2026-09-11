---
title: Web Standards First
description: Request, Response, Headers, FormData, Uint8Array and crypto.subtle instead of Node-specific types
---

# Web Standards First

`@loewen-digital/fullstack` is written against the Web Platform APIs that browsers, Node, Bun, Deno and Cloudflare Workers share. That is what makes the core framework-agnostic: a module that takes a `Request` runs behind any framework that hands one over, and every meta-framework does.

## The APIs in use

| Web Standard | Where |
|---|---|
| `Request` | `validateForm` and the adapters read forms and JSON from it; incoming webhooks are verified from it |
| `Response` | `errorToResponse` turns any error into one; the adapters return them |
| `Headers` | `corsHeaders` returns them, ready to merge into a response |
| `URL` | OAuth authorization URLs, cookie and redirect handling |
| `FormData` | Form parsing in `validateForm` |
| `ReadableStream` | Streamed uploads in `storage.put` and mail attachments |
| `Uint8Array` | Every byte buffer: storage contents, attachments, hashes |
| `crypto.subtle` | HMAC-SHA256 for CSRF tokens, signed session cookies and webhook signatures |
| `crypto.randomUUID`, `crypto.getRandomValues` | Ids and nonces |
| `fetch` | Every HTTP driver: Resend, Postmark, S3, R2, Meilisearch, Typesense, external log transport |

## Why not the Node APIs

Node's own HTTP types (`IncomingMessage`, `ServerResponse`, `Buffer`, `node:http`) exist only in Node. A module written against them needs a shim on every other runtime, and a framework adapter has to translate on the way in and out.

Every meta-framework (SvelteKit, Nuxt via Nitro, Remix, Astro) hands its server code a Web Standard `Request` and expects a `Response`. So the adapters are thin: they pass the request through and read a few framework-specific things such as `locals` and cookies.

## Reading a request

Node style, one runtime:

```ts
import type { IncomingMessage } from 'node:http'

function readBodyFromNode(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: string) => (body += chunk))
    req.on('end', () => resolve(body))
  })
}
```

Web Standard, every runtime:

```ts
function readBody(request: Request): Promise<string> {
  return request.text()
}
```

## `Uint8Array` instead of `Buffer`

`Buffer` is a Node subclass of `Uint8Array`. The package accepts and returns the base class, so bytes from `storage.get`, a `FormData` file or `crypto.subtle` all fit without conversion.

```ts
async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

async function digestOf(text: string) {
  return sha256(new TextEncoder().encode(text))
}
```

## `crypto.subtle` for signatures

Everything that signs or verifies uses the Web Crypto API: CSRF tokens are an HMAC over the session id, the cookie session driver signs its payload, incoming webhooks are checked against their signature header. The standalone security functions show the shape:

```ts
import { generateCsrfToken, verifyCsrfToken } from '@loewen-digital/fullstack/security'

async function roundTrip(sessionId: string, secret: string) {
  const token = await generateCsrfToken(sessionId, secret) // HMAC-SHA256 through crypto.subtle
  return verifyCsrfToken(sessionId, token, secret) // true
}
```

## Where Node is still needed

A few things have no Web Standard yet, and there the package uses Node built-ins. On Cloudflare Workers they run with the `nodejs_compat` flag; on Bun and Deno they work as they are.

| Module | Node API | Why |
|---|---|---|
| `auth` | `node:crypto` scrypt and `randomBytes` | Password hashing; Web Crypto has no memory-hard KDF |
| `db` | `better-sqlite3` | The bundled sqlite driver is a native binding |
| `storage` local driver, logging file transport | `node:fs` | Files on disk |
| `mail` SMTP driver | `nodemailer` | SMTP is a TCP protocol |

## A handler on any runtime

Because the modules take and return the standard types, a handler written once runs behind every adapter, or with none:

```ts
import { errorToResponse, NotFoundError } from '@loewen-digital/fullstack/errors'
import { corsHeaders } from '@loewen-digital/fullstack/security'
import type { StorageInstance } from '@loewen-digital/fullstack/storage'

export function createFileHandler(storage: StorageInstance) {
  return async (request: Request): Promise<Response> => {
    const cors = corsHeaders(request.headers.get('origin'), { origins: ['https://app.example.com'] })
    try {
      const key = new URL(request.url).pathname.slice('/files/'.length)
      const text = await storage.getText(key)
      if (text === null) throw new NotFoundError(`No file ${key}`)
      return new Response(text, { headers: cors })
    } catch (err) {
      return errorToResponse(err, cors)
    }
  }
}
```
