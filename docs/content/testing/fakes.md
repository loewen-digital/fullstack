---
title: Fakes
description: The mail, queue and storage fakes, and how to observe the other modules in tests
---

# Fakes

Three drivers exist for tests: `createFakeMailDriver`, `createFakeQueueDriver` and `createFakeStorageDriver`. They implement the module's driver interface, record what went through them, and expose that for assertions with your test runner's `expect`. `createTestStack` builds them for you as `fakeMail`, `fakeQueue` and `fakeStorage`; on their own they go into the module's `createXInstance`.

## Import

```ts
import { createFakeMailDriver, createFakeQueueDriver, createFakeStorageDriver } from '@loewen-digital/fullstack/testing'
```

## Mail

```ts
import { expect } from 'vitest'
import { createMailInstance } from '@loewen-digital/fullstack/mail'
import { createFakeMailDriver } from '@loewen-digital/fullstack/testing'

const fakeMail = createFakeMailDriver()
const mail = createMailInstance(fakeMail, { driver: 'console', from: 'My App <hello@example.com>' })

async function assertsMail() {
  await mail.send({ to: 'alice@example.com', cc: { name: 'Bob', email: 'bob@example.com' }, subject: 'Welcome!', text: 'Hi' })

  expect(fakeMail.sent).toHaveLength(1)
  expect(fakeMail.lastSent()?.from).toBe('My App <hello@example.com>')
  expect(fakeMail.sentTo('bob@example.com')).toHaveLength(1) // to, cc and bcc, by email address
  expect(fakeMail.sentWithSubject('Welcome!')).toHaveLength(1)

  fakeMail.clear()
  expect(fakeMail.sent).toHaveLength(0)
}
```

| Member | Description |
|---|---|
| `sent` | Every `MailMessage` since creation or `clear()` |
| `lastSent()` | The most recent one, or `undefined` |
| `sentTo(address)` | Messages whose `to`, `cc` or `bcc` contains the address |
| `sentWithSubject(subject)` | Messages with exactly that subject |
| `clear()` | Forget everything |

The console driver with `silent: true` records the same list as `mail.sent`, without the helpers.

## Queue

The fake queue records every dispatched job and processes like the memory driver: `queue.process()` runs the handlers, a failing job is retried up to `maxAttempts` and then lands in `failedJobs`.

```ts
import { expect } from 'vitest'
import { createQueueInstance } from '@loewen-digital/fullstack/queue'
import { createFakeQueueDriver } from '@loewen-digital/fullstack/testing'

const fakeQueue = createFakeQueueDriver()
const queue = createQueueInstance(fakeQueue)

async function assertsJobs() {
  const handled: number[] = []
  queue.handle<{ userId: number }>('send-welcome-email', (job) => {
    handled.push(job.payload.userId)
  })
  queue.handle('always-fails', () => {
    throw new Error('boom')
  })

  await queue.dispatch({ name: 'send-welcome-email', payload: { userId: 42 } })
  await queue.dispatch({ name: 'always-fails', payload: {}, maxAttempts: 2 })

  expect(fakeQueue.dispatched.map((job) => job.name)).toEqual(['send-welcome-email', 'always-fails'])

  await queue.process() // runs everything pending, including the retries
  expect(handled).toEqual([42])
  expect(fakeQueue.failedJobs).toHaveLength(1)
  expect(fakeQueue.dispatched).toHaveLength(2) // dispatched keeps the history until clear()

  fakeQueue.clear()
}
```

| Member | Description |
|---|---|
| `dispatched` | Every job pushed since creation or `clear()`, processed or not |
| `failedJobs` | Jobs that exhausted `maxAttempts` |
| `clear()` | Forget dispatched, pending and failed jobs |

## Storage

The fake storage is the memory driver plus a look inside.

```ts
import { expect } from 'vitest'
import { createStorageInstance } from '@loewen-digital/fullstack/storage'
import { createFakeStorageDriver } from '@loewen-digital/fullstack/testing'

const fakeStorage = createFakeStorageDriver('http://localhost/storage')
const storage = createStorageInstance(fakeStorage)

async function assertsFiles() {
  await storage.put('avatars/alice.png', new Uint8Array([1, 2, 3]))

  expect(fakeStorage.keys()).toEqual(['avatars/alice.png'])
  expect(fakeStorage.size).toBe(1)
  expect(await storage.getUrl('avatars/alice.png')).toBe('http://localhost/storage/avatars/alice.png')

  fakeStorage.clear()
  expect(await storage.exists('avatars/alice.png')).toBe(false)
}
```

| Member | Description |
|---|---|
| `keys()` | Every stored key |
| `size` | Number of stored files |
| `clear()` | Remove every file |

`createFakeStorageDriver(baseUrl?)` builds URLs as `baseUrl/key`; the default is `http://localhost/storage`.

## The other modules

Cache, session and events have nothing to fake: the memory drivers hold real state you can read back, and a listener records what the bus emitted.

```ts
import { expect } from 'vitest'
import { createEventBus } from '@loewen-digital/fullstack/events'

type Events = { 'user.registered': { email: string } }

async function assertsEvents() {
  const events = createEventBus<Events>()
  const emitted: Events['user.registered'][] = []
  events.on('user.registered', (payload) => {
    emitted.push(payload)
  })

  await events.emit('user.registered', { email: 'alice@example.com' })
  expect(emitted).toEqual([{ email: 'alice@example.com' }])
}
```

Notifications take the fake mail through their dependencies: `createNotifications({}, { mail })` with the instance above, and the in-app store is readable through `getInApp(userId)`.
