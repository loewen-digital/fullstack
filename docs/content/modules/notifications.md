---
title: Notifications
description: One notification object, delivered on mail, in-app, SMS and push channels, with a register of each user's devices and a Web Push driver
---

# Notifications

`createNotifications` delivers a notification to a user on the channels the notification names. Mail goes through a `MailInstance`, in-app notifications are kept in memory with read state, SMS goes through a driver you supply. Push reaches every browser and installed web app the user switched notifications on for: the module keeps a register of each user's devices and ships a Web Push driver. A notification is a plain object: `channels()` plus one `toX(user)` method per channel.

## Import

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'
```

## Setup

`createNotifications(config, deps)` takes the mail instance and the SMS driver as dependencies; `createStack` passes its `mail` for you.

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({ driver: 'console', from: 'My App <hello@example.com>' })

export const notifications = createNotifications({}, { mail })
```

## Defining a notification

```ts
import type { Notification, NotificationUser } from '@loewen-digital/fullstack/notifications'

export function orderShipped(orderId: string, eta: string): Notification {
  return {
    channels: () => ['mail', 'in-app'],
    toMail: (user) => ({
      to: user.email!, // the mail channel needs an address; users without one get the other channels
      subject: `Order ${orderId} has shipped`,
      text: `Your order is on its way. Expected delivery: ${eta}`,
    }),
    toInApp: () => ({
      type: 'order.shipped',
      title: 'Order shipped',
      message: `Order ${orderId} is on its way`,
      data: { orderId },
    }),
  }
}

async function ship(user: NotificationUser, orderId: string) {
  const report = await notifications.notify(user, orderShipped(orderId, 'Friday'))
  if (!report.ok) console.warn('not every channel delivered', report.channels)
}
```

`NotificationUser` is `{ id, email?, phone? }` plus anything else; the channels read `email` and `phone`, the push channel looks the user's devices up under `String(user.id)`. `notify` runs the channels one after another. A channel that fails (no driver, no `toX` method, no phone number, a send error) does not stop the others; `notify` throws only when every channel threw.

## What notify answers

`notify` returns a report, one entry per channel the notification named:

| Field | |
|---|---|
| `ok` | `true` when every channel delivered and no device failed |
| `channels[].channel` | `'mail'`, `'in-app'`, `'sms'` or `'push'` |
| `channels[].ok` | `false` when the channel could not deliver, or, for push, when a device failed |
| `channels[].error` | What the channel threw |
| `channels[].devices` | Push only: one `{ deviceId, kind, status, reason? }` per registered device of the user |

## In-app notifications

The in-app channel stores what `toInApp` returns, with an id, the user id, `read: false` and a timestamp, in memory on the instance: gone on restart, per isolate on Workers.

```ts
async function inbox(userId: string | number) {
  const items = notifications.getInApp(userId) // InAppNotification[]
  const unread = notifications.unreadCount(userId)
  return { items, unread }
}

function seen(notificationId: string, userId: string | number) {
  notifications.markAsRead(notificationId)
  notifications.markAllAsRead(userId)
}
```

## Push

The push channel has two parts. The register remembers which devices a user has, in a store. A driver per kind of device sends to them; the kind of a browser is `web-push`. `notify` sends to every device of the user, removes the ones a push service reports as gone, and says in its report what became of each.

```ts
// src/lib/server/notifications.ts
import { env } from '$env/dynamic/private'
import { FsAdapter } from '@loewen-digital/flatdb'
import { createNotifications, createWebPushDriver } from '@loewen-digital/fullstack/notifications'
import { createFlatdbDeviceStore } from '@loewen-digital/fullstack/notifications/flatdb'

export const notifications = createNotifications({
  channels: {
    push: {
      store: createFlatdbDeviceStore({ adapter: new FsAdapter('./data') }),
      drivers: [
        createWebPushDriver({
          vapid: {
            publicKey: env.VAPID_PUBLIC_KEY!,
            privateKey: env.VAPID_PRIVATE_KEY!,
            subject: 'mailto:ops@example.com',
          },
        }),
      ],
    },
  },
})
```

| Option | | |
|---|---|---|
| `store` | required | Where the devices are kept. There is no default: devices in the memory of one process are lost with it |
| `drivers` | required | One driver per kind of device. Two of the same kind throw |
| `onError` | optional | Called with what the store threw while a gone device was removed (default: `console.error`). The device stays and is tried again |

### The VAPID keys

A push service takes a message only from the sender a browser subscribed to. The sender is a key pair: the page subscribes with the public key, the server signs with the private one.

```bash
node -e "import('@loewen-digital/fullstack/notifications').then((m) => m.generateVapidKeys()).then(console.log)"
```

Both values are base64url. The private key is a secret: it belongs in the environment, never in the repository. The public key is not; the page needs it. Make the pair once and keep it: a subscription is bound to the public key it was made with, so a new pair orphans every registered browser. `subject` is a `mailto:` address or an `https:` URL where a push service can reach you about your traffic.

### Registering a browser

The page asks for permission, subscribes at the browser's push service and posts the subscription to a route of the app. Ask from a click: Safari requires one, and a prompt on page load is the one users deny. iOS only offers push to a web app that was added to the Home Screen.

```ts
// src/lib/push.ts
/** Asks for permission, subscribes this browser and registers it for the signed-in user */
export async function enablePush(publicKey: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if ((await Notification.requestPermission()) !== 'granted') return false

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }))

  const response = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription), // { endpoint, expirationTime, keys: { p256dh, auth } }
  })
  return response.ok
}

/** Removes this browser from the user's devices and ends its subscription */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  await fetch('/api/push', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  await subscription.unsubscribe()
}
```

```ts
// src/app.d.ts
import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'

declare global {
  namespace App {
    interface Locals extends FullstackLocals {}
  }
}

export {}
```

```ts
// src/routes/api/push/+server.ts
import { error, json } from '@sveltejs/kit'
import { PushDeviceError } from '@loewen-digital/fullstack/notifications'
import { notifications } from '#lib/server/notifications.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)

  try {
    const device = await notifications.devices.register(String(locals.authSession.userId), {
      kind: 'web-push',
      subscription: await request.json(),
    })
    return json({ id: device.id }, { status: 201 })
  } catch (thrown) {
    if (thrown instanceof PushDeviceError) error(400, thrown.message)
    throw thrown
  }
}

export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)

  const { endpoint } = await request.json()
  await notifications.devices.unregister(String(locals.authSession.userId), {
    kind: 'web-push',
    subscription: { endpoint },
  })
  return new Response(null, { status: 204 })
}
```

The user id comes from the session, never from the request body. Call `disablePush()` on logout too: a browser that stays registered keeps receiving the notifications of the user who left.

| `notifications.devices` | |
|---|---|
| `register(userId, device)` | Checks the device with the driver of its `kind`, stores it and returns `{ id, kind, target, registeredAt }`. The same browser registered again stays one entry. Throws `PushDeviceError` for anything that is not a device |
| `unregister(userId, device)` | Removes a device, named by its `id` or by what identified it at registration (`{ kind: 'web-push', subscription: { endpoint } }`). `false` when there was none |
| `list(userId)` | The user's devices. `target` holds the endpoint and keys: do not send it to a client and do not log it |
| `forget(userId)` | Removes every device of the user and answers how many |

A user has any number of devices. A device belongs to one user at a time: when a second user registers the same browser, it moves to them, so a shared computer stops showing the first user's notifications. The `id` is a hash of the kind and the endpoint; it tells the devices of a user apart without revealing either.

The route above makes the server post to the endpoint a signed-in user handed over. The driver therefore takes https endpoints of the browsers' push services only, see [the driver's options](#the-web-push-driver). Put a [rate limit](/modules/security) on the route as on any other that writes.

### The service worker

The push service wakes the service worker with the decrypted message: the `title`, `body`, `url`, `tag`, `icon` and `data` of the payload. The worker shows it and opens the link on a tap.

```js
// src/service-worker.js
self.addEventListener('push', (event) => {
  const message = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(message.title ?? '', {
      body: message.body,
      icon: message.icon,
      tag: message.tag, // replaces a notification with the same tag that is still shown
      data: { ...message.data, url: message.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data.url, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === url)
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})
```

A `push` event has to show a notification: a browser shows a notice of its own, or ends the subscription, when a worker takes messages silently.

### Sending

```ts
// src/lib/server/reminders.ts
import type { Notification } from '@loewen-digital/fullstack/notifications'
import { notifications } from '#lib/server/notifications.js'

export function kickOff(matchday: number): Notification {
  return {
    channels: () => ['push'],
    toPush: () => ({
      title: 'Kick-off in an hour',
      body: `Matchday ${matchday} starts at 20:00`,
      url: `/matchday/${matchday}`,
      tag: 'kick-off',
      ttl: 3600, // nobody needs this reminder tomorrow
    }),
  }
}

export async function remind(userId: string, matchday: number) {
  const report = await notifications.notify({ id: userId }, kickOff(matchday))

  const push = report.channels.find((entry) => entry.channel === 'push')
  for (const device of push?.devices ?? []) {
    if (device.status === 'failed') console.warn(`push to ${device.deviceId} failed: ${device.reason}`)
  }
}
```

| `PushPayload` | |
|---|---|
| `title`, `body` | What the notification shows |
| `url` | What a tap opens: a path of the app or a full URL |
| `tag` | The kind of message. A notification replaces an older one with the same tag, on the device and at the push service while the device is offline |
| `icon`, `data` | Passed to the service worker as they are |
| `ttl` | Seconds the push service keeps the message for a device that is offline. Left out: the driver's `ttl` |

Each device gets the notification on its own, all at the same time. What became of it is the `status` in the report:

| `status` | |
|---|---|
| `sent` | The push service took the message |
| `gone` | The push service no longer knows the browser (404 or 410): the user withdrew the permission or cleared the site's data. The register removed the device |
| `failed` | Not delivered, the device stays: the push service was unreachable or refused, or the payload is too large. `reason` says which, without the endpoint. The next `notify` tries the device again; nothing retries on its own |

A user without devices is not an error: the push entry is `ok` with an empty `devices`. On Cloudflare Workers every device is one subrequest of the request that notifies.

### When an account is deleted

A subscription is personal data of the account it was registered for.

```ts
// src/lib/server/account.ts
import { notifications } from '#lib/server/notifications.js'

export async function deleteAccount(userId: string) {
  const removed = await notifications.devices.forget(userId)
  console.log(`removed ${removed} devices`)
  // ... then the rest of the account
}
```

### Stores

| Store | | Holds its guarantee across |
|---|---|---|
| `createMemoryDeviceStore()` | Development and tests. Gone with the process | One process |
| `createFlatdbDeviceStore({ adapter, prefix? })` | JSON files on the storage adapter your `flatdb()` runs on, from `@loewen-digital/fullstack/notifications/flatdb` | What the adapter coordinates, see below |

The flatdb store takes the adapter, not collections: it writes one file per user, `push/users/<user>.json`, with the adapter's compare-and-swap (`readVersioned` and `writeIf`), which a collection's `update` does not offer, and one file per device, `push/owners/<device>.json`, that names the user holding it. Two browsers of one user that register in the same instant are both kept. `forget` deletes the user's file, so nothing named after the account stays. An adapter without the pair is refused when the store is created. It needs `@loewen-digital/flatdb` 0.3 or later.

- **`R2Adapter`**: the swap is on the object's etag and holds across every Worker request and isolate. Build adapter, store and notifications per request from `platform.env`, like the database in the [flatdb guide](/guides/auth-on-flatdb).
- **`FsAdapter`**: holds within one process. Two processes on one folder (two dev servers) are not coordinated.
- **`prefix`** (default `push`) is a folder below the adapter's root. Do not name a collection the same: the files there have no collection index.
- User ids become file names: lower-case letters, digits, `_` and `-` stay, everything else is escaped.

A store of your own is four methods:

```ts
import type { DeviceStore, PushDevice } from '@loewen-digital/fullstack/notifications'

const devicesOf = new Map<string, PushDevice[]>()

const ownStore: DeviceStore = {
  async list(userId) {
    return devicesOf.get(userId) ?? []
  },
  async put(userId, device) {
    // A device id belongs to one user at a time.
    for (const [owner, devices] of devicesOf) {
      devicesOf.set(owner, devices.filter((entry) => entry.id !== device.id))
    }
    devicesOf.set(userId, [...(devicesOf.get(userId) ?? []), device])
  },
  async remove(userId, deviceId) {
    const devices = devicesOf.get(userId) ?? []
    devicesOf.set(userId, devices.filter((entry) => entry.id !== deviceId))
    return devices.some((entry) => entry.id === deviceId)
  },
  async removeAll(userId) {
    const count = devicesOf.get(userId)?.length ?? 0
    devicesOf.delete(userId)
    return count
  },
}
```

On SQL that is a table with the device id as its primary key and the user id in a column: `put` is an upsert, which moves a device to its new user by itself. `target` is plain JSON data.

### The Web Push driver

`createWebPushDriver(config)` encrypts each message for the browser it goes to (RFC 8291, `aes128gcm`) and signs the request with the VAPID key (RFC 8292). It uses Web Crypto and `fetch` only: no dependency, and the same code on Node and on Cloudflare Workers.

| Option | | |
|---|---|---|
| `vapid` | required | `{ publicKey, privateKey, subject }`, see [The VAPID keys](#the-vapid-keys). Keys of the wrong form throw when the driver is created |
| `ttl` | optional | Seconds a push service keeps a message for a browser that is offline (default 86400, a day). `ttl` on a payload wins |
| `urgency` | optional | `'very-low'`, `'low'`, `'normal'` (default) or `'high'`: how soon a push service wakes a device that saves power |
| `endpointHosts` | optional | The hosts an endpoint may have; an entry covers its subdomains. Default: `webPushHosts`. `'any'` takes every https host |
| `timeoutMs` | optional | How long to wait for a push service (default 10000) |
| `fetch` | optional | Replaces the global `fetch`, for tests |

What to know about it:

- **Endpoints.** A subscription's endpoint is a URL the client names and the server posts to. By default the driver takes the push services of the browsers only: Google's (Chrome and the Chromium browsers), Mozilla's, Microsoft's and Apple's, exported as `webPushHosts`. A registration with another host is refused with a `PushDeviceError` that names the host; add it with `endpointHosts: [...webPushHosts, 'push.example.com']` when it is a push service. `'any'` lets a signed-in user make your server post to a host of their choice.
- **Size.** A push service takes 4096 bytes. The JSON of a payload may be `WEB_PUSH_MAX_PAYLOAD` (3993) bytes; a larger one fails for every device without being sent. Send an id and let the page load the rest.
- **The tag** becomes the `Topic` of the request, as a hash: a push service keeps one pending message per topic, so a device that comes back online gets the newest of a kind.
- **The token.** The driver signs one VAPID token per push service for twelve hours and reuses it.
- **Redirects** are not followed, and an answer other than 2xx, 404 or 410 is a `failed` device with the status and the first 200 characters of what the service said.
- **A wrong key pair** shows on the first send: every device fails with a reason that names the keys.

### Your own driver

A driver reaches the devices of one kind. `keyOf` reads what identifies a device from what the app handed over, `targetOf` checks all of it and returns what the register stores, `send` delivers to one device and answers `sent`, `gone` or `failed` instead of throwing.

```ts
import type { PushDeviceInput, PushDriver } from '@loewen-digital/fullstack/notifications'
import { PushDeviceError } from '@loewen-digital/fullstack/notifications'

type GatewayTarget = { token: string }

function tokenOf(input: PushDeviceInput): string {
  if (typeof input.token !== 'string' || input.token === '') {
    throw new PushDeviceError('gateway: a device needs a token')
  }
  return input.token
}

const gateway: PushDriver<GatewayTarget> = {
  kind: 'gateway',
  keyOf: (input) => tokenOf(input),
  targetOf: (input) => ({ token: tokenOf(input) }),
  async send(target, payload) {
    const response = await fetch('https://push.example.com/send', {
      method: 'POST',
      body: JSON.stringify({ to: target.token, title: payload.title, body: payload.body }),
    })
    if (response.ok) return { status: 'sent' }
    if (response.status === 404) return { status: 'gone' }
    return { status: 'failed', reason: `the gateway answered ${response.status}` }
  },
}
```

A device registers with `{ kind: 'gateway', token }` and is sent through this driver; `gone` removes it from the register.

### Testing

`createFakePushDriver` from [testing](/testing/fakes) stands in for the Web Push driver: it takes what the app's registration code hands over, records what was sent to which device, and lets a test decide how a device answers.

```ts
import { expect } from 'vitest'
import { createMemoryDeviceStore } from '@loewen-digital/fullstack/notifications'
import { createFakePushDriver } from '@loewen-digital/fullstack/testing'

async function assertsPush() {
  const fakePush = createFakePushDriver()
  const push = createNotifications({
    channels: { push: { store: createMemoryDeviceStore(), drivers: [fakePush] } },
  })
  const hello: Notification = { channels: () => ['push'], toPush: () => ({ title: 'Hello', body: 'World' }) }

  await push.devices.register('u1', fakePush.device('laptop'))
  await push.devices.register('u1', fakePush.device('phone'))

  await push.notify({ id: 'u1' }, hello)
  expect(fakePush.sent.map((entry) => entry.key)).toEqual(['laptop', 'phone'])

  fakePush.gone('laptop') // the push service dropped this subscription
  const report = await push.notify({ id: 'u1' }, hello)
  expect(report.channels[0]?.devices?.[0]?.status).toBe('gone')
  expect(await push.devices.list('u1')).toHaveLength(1)
}
```

### What it does not do

Web Push reaches browsers and web apps on the Home Screen; it does not reach a web view inside an app from the App Store, and there is no driver for APNs or FCM. Nothing is scheduled, there are no quiet hours and no preferences per kind of message: the app decides whom to notify and when. A failed device is reported, not retried; put `notify` in a [queue](/modules/queue) job when a notification must survive an outage of a push service.

## SMS driver

A driver is an object with one `send` method; `toSms` returns the message body.

```ts
import type { SmsDriver } from '@loewen-digital/fullstack/notifications'

const sms: SmsDriver = {
  async send(to, message) {
    await fetch('https://sms.example.com/send', { method: 'POST', body: JSON.stringify({ to, message }) })
  },
}

const withSms = createNotifications({}, { mail, sms })
```

## Config options

`createNotifications(config, deps)` reads these.

| Option | Type | Description |
|---|---|---|
| `channels.sms` | `SmsDriver` | SMS driver, used when `deps.sms` is not given |
| `channels.push` | `{ store, drivers, onError? }` | The push channel, see [Push](#push) |

| Dependency | Type | Description |
|---|---|---|
| `mail` | `MailInstance` | Required for the `mail` channel |
| `sms` | `SmsDriver` | Wins over `config.channels.sms` |
