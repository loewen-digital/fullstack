---
title: Events
description: A typed in-process event bus with async listeners
---

# Events

`createEventBus` is an in-process event bus: named events, a payload each, listeners that may be async. No broker, no network, nothing to configure; a type parameter makes event names and payloads type-checked.

## Import

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'
```

## Typed events

Give the bus a map from event name to payload. `on`, `once` and `emit` are then checked against it.

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'

type AppEvents = {
  'user.registered': { id: number; email: string }
  'order.placed': { orderId: string; total: number }
}

export const events = createEventBus<AppEvents>()

events.on('user.registered', async ({ email }) => {
  await sendWelcomeMail(email)
})

async function register(email: string) {
  await events.emit('user.registered', { id: 1, email })
}

async function sendWelcomeMail(to: string) {
  console.log('welcome', to)
}
```

Without a type parameter any string is an event and payloads are untyped. `defineEvents<AppEvents>()` returns a typed empty object for the `createEventBus<typeof events>()` style; it does nothing at runtime.

## How emit runs listeners

`emit` awaits the listeners one after another in registration order and resolves when all are done. A listener that throws does not stop the others: `emit` runs every listener, then rethrows the first error. There is no error option; wrap `emit` where a failing listener must not fail the caller.

```ts
async function placeOrder(orderId: string, total: number) {
  try {
    await events.emit('order.placed', { orderId, total })
  } catch (err) {
    console.error('a listener failed', err) // the order is placed either way
  }
}
```

## Unsubscribing

`on` and `once` return an unsubscribe function; `off` removes a listener by reference. `once` removes itself before it runs.

```ts
const stop = events.on('order.placed', ({ orderId }) => console.log('placed', orderId))
stop()

events.once('order.placed', ({ total }) => console.log('first order', total))

const audit = ({ orderId }: { orderId: string }) => console.log('audit', orderId)
events.on('order.placed', audit)
events.off('order.placed', audit)
```

## Config options

`createEventBus()` takes no config. Wildcard listeners and an error handler are not part of the module.
