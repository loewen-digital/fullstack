---
title: Webhooks
description: Verify incoming webhook signatures, send signed outgoing webhooks with retries
---

# Webhooks

`createWebhooks` does two things: `verify` checks an incoming request's HMAC signature header against its raw body, and `send` POSTs a JSON payload to a URL, signed with your secret, with exponential-backoff retries and an in-memory delivery log. Both work on `Request` and `fetch`; signing is HMAC through `crypto.subtle`.

## Import

```ts
import { createWebhooks } from '@loewen-digital/fullstack/webhooks'
```

## Incoming: verifying a signature

`verify(request, { secret, header, algorithm?, prefix? })` reads the body from a clone (your handler can still read it), computes the HMAC and compares it to the header in constant time. GitHub sends `sha256=<hex>` in `x-hub-signature-256`; other services differ only in header, prefix and algorithm.

```ts
import { createWebhooks } from '@loewen-digital/fullstack/webhooks'

export const webhooks = createWebhooks({ secret: process.env.WEBHOOK_SECRET! })

export async function githubHook(request: Request): Promise<Response> {
  const result = await webhooks.verify(request, {
    secret: process.env.GITHUB_WEBHOOK_SECRET!,
    header: 'x-hub-signature-256',
    prefix: 'sha256=',
  })
  if (!result.valid) return new Response(result.reason, { status: 401 }) // 'Missing signature header: ...' or 'Signature mismatch'

  const event = request.headers.get('x-github-event')
  const payload = (await request.json()) as { action?: string }
  console.log(event, payload.action)
  return new Response(null, { status: 204 })
}
```

Signature schemes that hash a timestamp together with the body (Stripe's `t=...,v1=...`) need their own check; `signPayload` gives you the HMAC to compare.

## Outgoing: sending a webhook

`send({ url, event, payload, headers? })` POSTs the payload as JSON with `X-Webhook-Event` and, when a secret is configured, `X-Webhook-Signature: sha256=<hex>` over the body. A non-2xx status or a network error is retried up to `maxRetries` times, waiting `retryDelay`, then twice that, and so on. The result says whether it got through and after how many attempts.

```ts
async function orderCreated(orderId: string, subscriberUrl: string) {
  const delivery = await webhooks.send({
    url: subscriberUrl,
    event: 'order.created',
    payload: { orderId, total: 49.99 },
    headers: { 'x-tenant': 'acme' },
  })
  return delivery // { ok: true, status: 200, attempts: 1 } or { ok: false, error: 'HTTP 503', attempts: 4 }
}
```

The receiver verifies with the same module:

```ts
async function receiveOurWebhook(request: Request, sharedSecret: string): Promise<Response> {
  const result = await webhooks.verify(request, { secret: sharedSecret, header: 'x-webhook-signature', prefix: 'sha256=' })
  return new Response(null, { status: result.valid ? 204 : 401 })
}
```

## Delivery log

Every `send` is logged in memory on the instance: `{ id, url, event, payload, result, deliveredAt }`. Persist it yourself if you need history across restarts; there is no subscriber registry or broadcast.

```ts
function recentFailures() {
  return webhooks.getLogs().filter((entry) => !entry.result.ok)
}
```

## Standalone functions

`verifyIncomingWebhook(request, options)`, `sendOutgoingWebhook(webhook, config)` and `signPayload(payload, secret, algorithm?)` work without an instance.

```ts
import { signPayload } from '@loewen-digital/fullstack/webhooks'

async function signForTest(body: string) {
  return `sha256=${await signPayload(body, 'test-secret')}` // the header a test request carries
}
```

## Config options

`createWebhooks(config?)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | none | Signs outgoing payloads; without it no signature header is sent |
| `maxRetries` | `number` | `3` | Retries after the first attempt (four attempts in total) |
| `retryDelay` | `number` | `1000` | First wait in milliseconds, doubled per retry |

| Verify option | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | — | The sender's HMAC secret |
| `header` | `string` | — | Header that carries the signature |
| `algorithm` | `'hmac-sha256' \| 'hmac-sha1'` | `'hmac-sha256'` | Hash |
| `prefix` | `string` | `''` | Stripped from the header value before comparing (`sha256=`) |
