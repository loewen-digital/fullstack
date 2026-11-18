---
title: Fakes
description: The mail, queue, storage, billing, push and error fakes, and how to observe the other modules in tests
---

# Fakes

Six drivers exist for tests: `createFakeMailDriver`, `createFakeQueueDriver`, `createFakeStorageDriver`, `createFakeBillingDriver`, `createFakePushDriver` and `createFakeErrorDriver`. They implement the module's driver interface, record what went through them, and expose that for assertions with your test runner's `expect`. `createTestStack` builds them for you as `fakeMail`, `fakeQueue` and `fakeStorage`; on their own they go into the module's `createXInstance`.

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

## Billing

`createFakeBillingDriver` records checkouts and builds the webhook request for any event; `billing.handleWebhook` takes it like a provider's delivery. `proof(event)` builds the proof of a purchase made on the device, which `billing.verifyPurchase` takes for the user who hands it over. Only `type` is required on an event; leave out `providerId` and set `holdingId` for an event that names only its purchase, as Paddle's refunds do, and set `replacesHoldingId` for a purchase that takes the place of another one, as a change of plan at Google Play does. It is not part of `createTestStack`, because billing needs your products.

```ts
import { expect } from 'vitest'
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'
import { createFakeBillingDriver } from '@loewen-digital/fullstack/testing'

const fakeBilling = createFakeBillingDriver()
const billing = createBilling({
  driver: fakeBilling,
  store: createMemoryBillingStore(),
  products: { unlock: { type: 'one-time', providerId: 'pri_unlock' } },
})

async function assertsPurchases() {
  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'purchase.completed', userId: 'u1', providerId: 'pri_unlock' }),
  )
  expect((await billing.account('u1')).holdings[0]?.status).toBe('active')

  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'payment.refunded', userId: 'u1', providerId: 'pri_unlock' }),
  )
  expect((await billing.account('u1')).holdings[0]?.status).toBe('refunded')
}
```

| Member | Description |
|---|---|
| `webhook(event \| events)` | A `Request` that delivers the events. `type` and `providerId` are required; `id`, `occurredAt` and `holdingId` get defaults, and two events for the same user and product concern the same holding |
| `invalidWebhook()` | A `Request` that fails verification, answered with 401 |
| `proof(event \| events)` | The proof of a purchase from the device that says these events, as plain JSON. Without `userId` on an event the purchase is the one of whoever hands the proof over; with another user's id the proof is refused as `other-user` |
| `invalidProof()` | A proof that fails verification: `billing.verifyPurchase` throws a `BillingPurchaseError` with `reason: 'invalid'` |
| `checkouts` | What every `billing.checkout` handed to the driver |
| `manageRequests` | What every `billing.manageUrl` handed to the driver |
| `purchases` | What every `billing.verifyPurchase` handed to the driver: the user, the proof, the products |
| `clear()` | Forget checkouts, manage requests and purchases |

## Push

`createFakePushDriver` takes the place of the Web Push driver in `channels.push.drivers`, and `createFakePushDriver({ kind: 'apns' })` that of the APNs driver: it accepts what the app's registration code hands over, records what each device was sent, and answers as gone or failed for the devices a test names. `fakePush.device(name)` is a device to register; `name` is its key afterwards. It is not part of `createTestStack`, because the push channel needs a store.

```ts
import { expect } from 'vitest'
import { createMemoryDeviceStore, createNotifications } from '@loewen-digital/fullstack/notifications'
import type { Notification } from '@loewen-digital/fullstack/notifications'
import { createFakePushDriver } from '@loewen-digital/fullstack/testing'

const fakePush = createFakePushDriver()
const pushNotifications = createNotifications({
  channels: { push: { store: createMemoryDeviceStore(), drivers: [fakePush] } },
})
const kickOff: Notification = {
  channels: () => ['push'],
  toPush: () => ({ title: 'Kick-off', body: 'In an hour' }),
}

async function assertsPush() {
  await pushNotifications.devices.register('u1', fakePush.device('laptop'))
  await pushNotifications.devices.register('u1', fakePush.device('phone'))

  await pushNotifications.notify({ id: 'u1' }, kickOff)
  expect(fakePush.sent).toHaveLength(2)
  expect(fakePush.sent[0]).toEqual({ key: 'laptop', payload: { title: 'Kick-off', body: 'In an hour' } })

  fakePush.fail('phone') // the push service is down for this device
  const report = await pushNotifications.notify({ id: 'u1' }, kickOff)
  expect(report.ok).toBe(false)

  fakePush.gone('laptop') // the push service dropped this subscription
  await pushNotifications.notify({ id: 'u1' }, kickOff)
  expect(await pushNotifications.devices.list('u1')).toHaveLength(1) // the gone one was removed
}
```

| Member | Description |
|---|---|
| `device(name)` | A device to hand to `devices.register`: for the default kind a subscription whose endpoint ends in `name` |
| `sent` | `{ key, payload }` for every notification a device took. `key` is the name from `device()`, or the endpoint, `token` or `id` the app registered with |
| `gone(key)` | From now on the device answers as gone, so the register removes it |
| `fail(key, reason?)` | From now on the device answers as failed, with `reason` in the report |
| `clear()` | Forget what was sent and how devices answer |

`createFakePushDriver({ kind })` stands in for a driver of another kind; its devices are `{ kind, id: name }`.

## Errors

`createFakeErrorDriver` takes the place of the driver of [monitoring](/modules/monitoring) and keeps each report as the reporter built it. A test asserts on what would be reported, whatever server the app reports to in production.

```ts
import { expect } from 'vitest'
import { createErrorReporter } from '@loewen-digital/fullstack/monitoring'
import { createFakeErrorDriver } from '@loewen-digital/fullstack/testing'

const fakeErrors = createFakeErrorDriver()
const reporter = createErrorReporter({ driver: fakeErrors })

async function assertsErrors() {
  reporter.report(new TypeError('no items'), { route: '/items/[id]', method: 'GET' })
  await reporter.flush() // the delivery runs behind report()

  expect(fakeErrors.reports).toHaveLength(1)
  expect(fakeErrors.last()).toMatchObject({ type: 'TypeError', route: '/items/[id]', method: 'GET' })

  fakeErrors.fail() // from now on a delivery fails, as with a server that is down
  expect(() => reporter.report(new Error('lost'))).not.toThrow()
}
```

| Member | Description |
|---|---|
| `reports` | Every report that was handed over since creation or the last `clear()` |
| `last()` | The newest report |
| `fail(reason?)` | From now on a delivery rejects; the reporter tells its `onError` |
| `clear()` | Forget the reports, and deliver again |

`createFakeSentryServer` stands one step further out, where the server is: it takes the envelope the Sentry driver posts and keeps the events in it. Use it for a test of the whole path, and for a browser test, where the page's code sends for real.

```ts
import { createErrorReporter, createSentryDriver } from '@loewen-digital/fullstack/monitoring'
import { createFakeSentryServer } from '@loewen-digital/fullstack/testing'

const server = createFakeSentryServer() // dsn: https://public@errors.test/1
const sentryReporter = createErrorReporter({
  driver: createSentryDriver({ dsn: server.dsn, fetch: server.fetch }),
})

async function assertsEnvelope() {
  sentryReporter.report(new Error('boom'), { route: '/items/[id]' })
  await sentryReporter.flush()

  expect(server.events[0]?.transaction).toBe('/items/[id]')
  expect(server.events[0]?.exception.values.at(-1)?.value).toBe('boom')

  server.answer(429, { 'Retry-After': '60' }) // the server asks for silence
}
```

In a Playwright test the page gets `server.dsn` as its DSN and the test routes the requests to `handle()`, which answers with `Access-Control-Allow-Origin`; without that header the browser drops the request. Give the test a user agent of a real browser: Playwright's default says `HeadlessChrome`, and the reporter does not start for a headless browser.

```js
await page.route('https://errors.test/**', async (route) => {
  const request = route.request()
  const response = await server.handle(
    new Request(request.url(), { method: request.method(), body: request.postData() }),
  )
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  })
})
```

| Member | Description |
|---|---|
| `dsn` | The DSN to configure the driver with; `createFakeSentryServer({ dsn })` sets another one |
| `events` | Every event that arrived, as the driver wrote it: `exception`, `transaction`, `tags`, `breadcrumbs` |
| `fetch` | A `fetch` that ends at the fake, for the driver's `fetch` option |
| `handle(request)` | Takes a request as the real server does: the envelope `POST` and its preflight. A wrong key is answered with 403, another project with 404 |
| `answer(status, headers?)` | From now on every `POST` is answered with this status |
| `clear()` | Forget the events, and answer 200 again |

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
