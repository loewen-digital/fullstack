---
title: Webhooks
description: Incoming and outgoing webhook handling with signature verification
---

# Webhooks

The `webhooks` module handles both incoming webhook verification and outgoing webhook dispatch. It takes care of signature verification, retries, and delivery logging.

## Import

```ts
import { createWebhooks } from '@loewen-digital/fullstack/webhooks'
```

## Incoming webhooks

Verify and parse incoming webhooks from third-party services:

```ts
import { createWebhooks } from '@loewen-digital/fullstack/webhooks'

const webhooks = createWebhooks({
  incoming: {
    stripe: { secret: process.env.STRIPE_WEBHOOK_SECRET! },
    github: { secret: process.env.GITHUB_WEBHOOK_SECRET! },
  },
})

// In your webhook endpoint handler:
const event = await webhooks.receive('stripe', request)

if (!event.verified) {
  return new Response('Unauthorized', { status: 401 })
}

// event.type   — e.g. 'payment_intent.succeeded'
// event.data   — parsed JSON payload
switch (event.type) {
  case 'payment_intent.succeeded':
    await handlePayment(event.data)
    break
}
```

## Outgoing webhooks

Dispatch signed webhook payloads to subscriber URLs:

```ts
const webhooks = createWebhooks({
  outgoing: {
    secret: process.env.WEBHOOK_SIGNING_SECRET!,
    retries: 3,
    timeout: 10_000,
  },
})

// Send a webhook
await webhooks.dispatch('https://subscriber.example.com/webhook', {
  event: 'order.created',
  data: { orderId: 'ord_123', total: 49.99 },
})
```

## Managing subscriber endpoints

```ts
// Register a subscriber
await webhooks.subscribe({
  url: 'https://partner.example.com/hooks',
  events: ['order.created', 'order.shipped'],
})

// Unsubscribe
await webhooks.unsubscribe('https://partner.example.com/hooks')

// Broadcast to all subscribers listening for an event
await webhooks.broadcast('order.created', { orderId: 'ord_456' })
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `incoming` | `Record<string, { secret: string }>` | `{}` | Incoming webhook configurations by provider name |
| `outgoing.secret` | `string` | — | Secret for signing outgoing payloads |
| `outgoing.retries` | `number` | `3` | Number of retry attempts on delivery failure |
| `outgoing.timeout` | `number` | `10000` | Request timeout in milliseconds |
| `outgoing.signatureHeader` | `string` | `'X-Webhook-Signature'` | Header name for the signature |
