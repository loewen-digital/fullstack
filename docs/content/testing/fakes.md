---
title: Fakes
description: Fake implementations for testing mail, queue, events, storage, and more
---

# Fakes

Fakes are in-memory implementations of modules that record their calls, letting you assert that the right things happened without side effects.

## Mail fake

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({ driver: 'memory' })

// ... run code that sends email ...

// Assert a message was sent
mail.assertSent({ to: 'alice@example.com' })
mail.assertSent({ subject: 'Welcome!' })
mail.assertSent({ to: 'alice@example.com', subject: 'Welcome!' })

// Assert nothing was sent
mail.assertNothingSent()

// Assert count
mail.assertSentCount(2)

// Access all sent messages
const sent = mail.sent()
expect(sent[0].subject).toBe('Welcome!')
```

## Queue fake

```ts
import { createQueue } from '@loewen-digital/fullstack/queue'

const queue = createQueue({ driver: 'memory' })

// ... run code that dispatches jobs ...

// Assert a job was dispatched
queue.assertDispatched('send-welcome-email')
queue.assertDispatched('send-welcome-email', { userId: 42 })

// Assert nothing was dispatched
queue.assertNothingDispatched()

// Run all pending jobs synchronously (for testing)
await queue.runAll()
```

## Events fake

```ts
import { createEventBus } from '@loewen-digital/fullstack/events'

const events = createEventBus()

// ... run code that emits events ...

// Assert events were emitted
events.assertEmitted('user.registered')
events.assertEmitted('user.registered', { email: 'alice@example.com' })

// Assert count
events.assertEmittedCount('user.registered', 1)
```

## Storage fake

```ts
import { createStorage } from '@loewen-digital/fullstack/storage'

const storage = createStorage({ driver: 'memory' })

// Works exactly like real storage but stays in memory
await storage.put('avatars/alice.png', new Uint8Array([1, 2, 3]))
expect(await storage.exists('avatars/alice.png')).toBe(true)

// Inspect all stored files
const files = await storage.list()
```

## Cache fake

```ts
import { createCache } from '@loewen-digital/fullstack/cache'

const cache = createCache({ driver: 'memory' })

// Standard cache operations — no Redis needed
await cache.set('key', 'value', { ttl: 60 })
expect(await cache.get('key')).toBe('value')
```

## Notifications fake

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'

const notifications = createNotifications({
  channels: { mail: createMail({ driver: 'memory' }) },
})

// ... run code that sends notifications ...

notifications.assertSentTo(user, 'order.shipped')
notifications.assertNothingSent()
```
