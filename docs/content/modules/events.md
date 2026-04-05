---
title: Events
description: Lightweight in-process event bus for decoupled application logic
---

# Events

The events module is a lightweight, in-process event bus. It lets you decouple application logic by emitting named events and registering listeners — without any external broker or network hop.

## Import

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'
```

## Basic usage

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'

const events = createEventBus()

// Register a listener
events.on('user.registered', async (payload) => {
  console.log('New user:', payload.email)
})

// Emit an event
await events.emit('user.registered', { id: 1, email: 'alice@example.com' })
```

## Typed events

Define your event map for full type safety:

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'

type AppEvents = {
  'user.registered': { id: number; email: string }
  'order.placed': { orderId: string; total: number }
  'payment.failed': { orderId: string; reason: string }
}

const events = createEventBus<AppEvents>()

// TypeScript knows the shape of each event's payload
events.on('order.placed', async ({ orderId, total }) => {
  await sendOrderConfirmation(orderId, total)
})

await events.emit('order.placed', { orderId: 'ord_123', total: 49.99 })
```

## Multiple listeners

Multiple listeners can be registered for the same event. They are called in registration order:

```ts
events.on('user.registered', sendWelcomeEmail)
events.on('user.registered', createDefaultSettings)
events.on('user.registered', trackSignup)
```

## One-time listeners

```ts
events.once('app.boot', () => {
  console.log('Application started')
})
```

## Removing listeners

```ts
const handler = async (payload) => { /* ... */ }

events.on('user.registered', handler)
events.off('user.registered', handler)
```

## Error handling

By default, errors in listeners propagate to the `emit` caller. You can configure a global error handler:

```ts
const events = createEventBus({
  onError: (error, event, payload) => {
    logger.error('Event listener failed', { event, error })
  },
})
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `onError` | `(err, event, payload) => void` | rethrows | Global listener error handler |
| `wildcard` | `boolean` | `false` | Enable `*` wildcard listeners |
