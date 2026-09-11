---
title: Notifications
description: One notification object, delivered on mail, in-app, SMS and push channels
---

# Notifications

`createNotifications` delivers a notification to a user on the channels the notification names. Mail goes through a `MailInstance`, in-app notifications are kept in memory with read state, SMS and push go through drivers you supply. A notification is a plain object: `channels()` plus one `toX(user)` method per channel.

## Import

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'
```

## Setup

`createNotifications(config, deps)` takes the mail instance and the SMS and push drivers as dependencies; `createStack` passes its `mail` for you.

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
  await notifications.notify(user, orderShipped(orderId, 'Friday'))
}
```

`NotificationUser` is `{ id, email?, phone? }` plus anything else; the channels read `email` and `phone`. `notify` runs the channels one after another. A channel that fails (no driver, no `toX` method, no phone number, a send error) does not stop the others; `notify` throws only when every channel failed.

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

## SMS and push drivers

A driver is an object with one `send` method. `toSms` returns the message body, `toPush` a `{ title, body, icon?, data? }` payload.

```ts
import type { SmsDriver, PushDriver } from '@loewen-digital/fullstack/notifications'

const sms: SmsDriver = {
  async send(to, message) {
    await fetch('https://sms.example.com/send', { method: 'POST', body: JSON.stringify({ to, message }) })
  },
}

const push: PushDriver = {
  async send(userId, payload) {
    await fetch(`https://push.example.com/users/${userId}`, { method: 'POST', body: JSON.stringify(payload) })
  },
}

const withAllChannels = createNotifications({}, { mail, sms, push })
```

## Config options

`createNotifications(config, deps)` reads these.

| Option | Type | Description |
|---|---|---|
| `channels.sms` | `SmsDriver` | SMS driver, used when `deps.sms` is not given |
| `channels.push` | `PushDriver` | Push driver, used when `deps.push` is not given |

| Dependency | Type | Description |
|---|---|---|
| `mail` | `MailInstance` | Required for the `mail` channel |
| `sms` | `SmsDriver` | Wins over `config.channels.sms` |
| `push` | `PushDriver` | Wins over `config.channels.push` |
