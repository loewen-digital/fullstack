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

The push channel has two parts. The register remembers which devices a user has, in a store. A driver per kind of device sends to them: `web-push` is a browser or an installed web app, `apns` an iPhone or iPad app from the App Store ([The APNs driver](#the-apns-driver)). `notify` sends to every device of the user, removes the ones a push service reports as gone, and says in its report what became of each.

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
| `list(userId)` | The user's devices. `target` holds the endpoint and keys, or the device token: do not send it to a client and do not log it |
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
| `icon`, `data` | Passed to the service worker as they are. An iOS app gets `data`; its icon is the app's own |
| `ttl` | Seconds the push service keeps the message for a device that is offline. Left out: the driver's `ttl` |

Each device gets the notification on its own, all at the same time. What became of it is the `status` in the report:

| `status` | |
|---|---|
| `sent` | The push service took the message |
| `gone` | The push service no longer knows the device: a browser whose user withdrew the permission or cleared the site's data (404 or 410), an app that was removed from the iPhone. The register removed the device |
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

### The APNs driver

A web view inside an app from the App Store gets no Web Push. When the web app ships as an iOS app, its shell asks for permission, takes the device token Apple hands it and gives it to the app's route; `createApnsDriver(config)` sends to that token through Apple's push service (APNs), signed with a key of your developer team. It uses Web Crypto and `fetch` only: no dependency. Both drivers go into `drivers`, and one `notify` reaches a user's browsers and iPhones alike.

```ts
import { env } from '$env/dynamic/private'
import { createApnsDriver } from '@loewen-digital/fullstack/notifications'

const apns = createApnsDriver({
  teamId: env.APPLE_TEAM_ID!,
  keyId: env.APPLE_KEY_ID!,
  privateKey: env.APPLE_PRIVATE_KEY!,
  bundleId: 'com.example.app',
})

// channels: { push: { store, drivers: [createWebPushDriver({ vapid }), apns] } }
```

| Value | Where it comes from |
|---|---|
| `teamId` | The Team ID of the Apple developer account, ten characters, under Membership details |
| `keyId` | The Key ID of a key with the Apple Push Notifications service enabled, under Certificates, Identifiers & Profiles, Keys |
| `privateKey` | The contents of the `.p8` file of that key, with its `-----BEGIN PRIVATE KEY-----` lines. Apple lets you download it once |
| `bundleId` | The bundle id of the app. Its App ID needs the Push Notifications capability |

The `.p8` key is a secret, and it signs for every app of the team: it belongs in the environment, never in the repository, a log or a fixture. A key whose line breaks arrive as the two characters `\n` is read as well, so the file fits one line of a `.env`:

```bash
awk 'NF { printf "%s\\n", $0 }' AuthKey_ABC123DEFG.p8
```

One key serves every app of the team; the app is named by `bundleId`. A team whose keys are bound to one of Apple's two environments each gives the sandbox key as `sandbox: { keyId, privateKey }`.

#### Registering an iPhone

The shell receives the token as bytes and hands it over as hexadecimal digits, together with the environment that issued it: `sandbox` for a build run from Xcode (the entitlement `aps-environment` is `development`), `production` for TestFlight and the App Store. Let the page inside the web view post both, so the request carries the user's session.

```ts
// src/routes/api/push/apns/+server.ts
import { error, json } from '@sveltejs/kit'
import { PushDeviceError } from '@loewen-digital/fullstack/notifications'
import { notifications } from '#lib/server/notifications.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)

  const { token, environment } = await request.json()
  try {
    const device = await notifications.devices.register(String(locals.authSession.userId), {
      kind: 'apns',
      token, // 'a1b2c3...', hexadecimal
      environment, // 'production' or 'sandbox'
    })
    return json({ id: device.id }, { status: 201 })
  } catch (thrown) {
    if (thrown instanceof PushDeviceError) error(400, thrown.message)
    throw thrown
  }
}
```

A token that is not hexadecimal digits or an environment other than the two is refused with a `PushDeviceError`. The same token registered again stays one entry, and `unregister(userId, { kind: 'apns', token, environment })` removes it on logout. Apple may hand the app a new token at any start: register on every start.

#### What the app receives

```json
{
  "aps": { "alert": { "title": "Kick-off in an hour", "body": "Matchday 7" }, "sound": "default" },
  "url": "/matchday/7",
  "tag": "kick-off",
  "data": { "matchday": 7 }
}
```

iOS shows the title and the body by itself. `url`, `tag` and `data` arrive in the notification's `userInfo`: the shell opens `url` in the web view when the user taps. The tag is also the `apns-collapse-id` of the request, so a notification replaces the one with the same tag, on the device and at Apple while the device is offline. A tag of up to 64 visible ASCII characters is sent as it is, any other as its hash.

| Option | | |
|---|---|---|
| `teamId`, `keyId`, `privateKey`, `bundleId` | required | See above. Values of the wrong form throw when the driver is created |
| `sandbox` | optional | `{ keyId, privateKey }` for the devices of Apple's sandbox. Default: the key above signs for both |
| `ttl` | optional | Seconds Apple keeps a notification for a device that is offline (default 86400, a day). `0` tries once. `ttl` on a payload wins |
| `sound` | optional | The sound a notification plays: `'default'` (default), a file in the app's bundle, or `false` for none |
| `timeoutMs` | optional | How long to wait for Apple (default 10000) |
| `fetch` | optional | Replaces the global `fetch`: for tests, and for a runtime whose own `fetch` speaks no HTTP/2 |

What to know about it:

- **Where the request goes.** To `api.push.apple.com` or `api.sandbox.push.apple.com`, by the environment the device registered with. Nothing a client hands over is part of the address but the token, which is hexadecimal digits.
- **The provider token.** The driver signs one token per key and uses it for 45 minutes: Apple takes a token for an hour and reports a sender that replaces it within twenty minutes (`TooManyProviderTokenUpdates`). Create the driver once per process or Worker isolate, at module scope, not once per request; the store may still be built per request.
- **Size.** Apple takes 4096 bytes (`APNS_MAX_PAYLOAD`). A larger payload fails for the device without being sent.
- **Gone.** `Unregistered` and `ExpiredToken` (410) and `BadDeviceToken` (400) remove the device from the register. Apple answers `BadDeviceToken` also for a sandbox token that registered as `production` or the other way round: such a device is removed and comes back when the app registers with the right environment.
- **Refused.** Every other answer is a `failed` device whose `reason` is Apple's, like `Apple answered 403 InvalidProviderToken`, without the token:

| Apple's reason | Look at |
|---|---|
| `InvalidProviderToken` | `teamId`, `keyId` and `privateKey` do not belong together, or the key was revoked |
| `BadEnvironmentKeyIdInToken` | The key is bound to the other environment: `sandbox` |
| `BadTopic`, `TopicDisallowed` | `bundleId` is not an app of the team, or its App ID has no Push Notifications capability |
| `DeviceTokenNotForTopic` | The token belongs to another app than `bundleId` |
| `TooManyProviderTokenUpdates` | Usually a driver that is created per request instead of once per process |

#### Where it runs

Apple's API speaks HTTP/2 only, so the driver needs a `fetch` that does:

| Runtime | Its `fetch` reaches Apple |
|---|---|
| A Worker on Cloudflare's network | yes |
| `wrangler dev` and Miniflare, the local workerd | no: every device fails with "Network connection lost" |
| Node 26 and later | yes |
| Node 24 and earlier | no: every device fails with a reason that says so. Hand the driver the `fetch` below |

On a Node whose own `fetch` speaks HTTP/1.1, give the driver one that opens an HTTP/2 connection with Node's own module. This one opens a connection per notification, which is fine for reminders and slow for a broadcast:

```ts
// src/lib/server/http2-fetch.ts
import { connect } from 'node:http2'

/** A `fetch` for the APNs driver: one HTTP/2 connection per request */
export const http2Fetch: typeof fetch = (input, init) =>
  new Promise((resolve, reject) => {
    const url = new URL(String(input))
    const session = connect(url.origin)
    const fail = (reason: unknown) => {
      session.destroy()
      reject(reason)
    }
    session.on('error', fail)
    init?.signal?.addEventListener('abort', () => fail(init.signal?.reason), { once: true })

    const stream = session.request({
      ':method': init?.method ?? 'GET',
      ':path': url.pathname,
      ...(init?.headers as Record<string, string>),
    })
    let status = 0
    let text = ''
    stream.setEncoding('utf8')
    stream.on('response', (headers) => {
      status = Number(headers[':status'])
    })
    stream.on('data', (chunk: string) => {
      text += chunk
    })
    stream.on('error', fail)
    stream.on('end', () => {
      session.close()
      try {
        resolve(new Response(text === '' ? null : text, { status }))
      } catch (thrown) {
        reject(thrown)
      }
    })
    stream.end(init?.body as Uint8Array)
  })
```

`createApnsDriver({ ..., fetch: http2Fetch })` then sends through it.

#### Checking against Apple's sandbox

The tests of this package run on recorded answers. To see a notification arrive, run the app from Xcode in the Simulator, which registers with Apple's sandbox, copy the token the app prints, and send to it. The script needs a runtime from the table above: Node 26, or `fetch: http2Fetch`.

```ts
// scripts/verify-apns.ts
import { createApnsDriver } from '@loewen-digital/fullstack/notifications'

const driver = createApnsDriver({
  teamId: process.env.APPLE_TEAM_ID!,
  keyId: process.env.APPLE_KEY_ID!,
  privateKey: process.env.APPLE_PRIVATE_KEY!,
  bundleId: process.env.APPLE_BUNDLE_ID!,
})

const target = await driver.targetOf({
  kind: 'apns',
  token: process.env.APNS_DEVICE_TOKEN!,
  environment: 'sandbox',
})
console.log(await driver.send(target, { title: 'Hello', body: 'From the sandbox', url: '/' }))
```

```bash
node --env-file=.env scripts/verify-apns.ts
```

`{ status: 'sent' }` means Apple took the notification, and it shows on the device when the app has the permission. Anything else carries Apple's reason, see the table above. Apple's Push Notifications Console sends a test notification to the same token without any of this, which tells a problem of the app apart from one of the server.

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

`createFakePushDriver` from [testing](/testing/fakes) stands in for the Web Push driver, and with `{ kind: 'apns' }` for the APNs driver: it takes what the app's registration code hands over, records what was sent to which device, and lets a test decide how a device answers.

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

Web Push reaches browsers and web apps on the Home Screen, the APNs driver an app from the App Store. There is no driver for FCM: an Android app that is a Trusted Web Activity gets Web Push. The APNs driver sends notifications a user sees: no silent or background pushes, no Live Activities, no authentication by certificate, and the Swift code of the app is yours. Nothing is scheduled, there are no quiet hours and no preferences per kind of message: the app decides whom to notify and when. A failed device is reported, not retried; put `notify` in a [queue](/modules/queue) job when a notification must survive an outage of a push service.

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
