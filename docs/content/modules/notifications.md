---
title: Notifications
description: Multi-channel notifications via email, SMS, and other channels
---

# Notifications

The `notifications` module delivers structured notifications to users through multiple channels — email, SMS, push, and more — from a single, unified API.

## Import

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'
```

## Basic usage

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'

const notifications = createNotifications({
  channels: {
    mail: mailInstance,
  },
})

// Send a notification to a user
await notifications.send(user, {
  mail: {
    subject: 'Your order has shipped',
    text: `Your order #${order.id} is on its way!`,
  },
})
```

## Defining notification classes

For reusable, typed notifications:

```ts
import type { Notification } from '@loewen-digital/fullstack/notifications'

function orderShipped(order: Order): Notification {
  return {
    mail: (user) => ({
      to: user.email,
      subject: `Order #${order.id} has shipped`,
      text: `Your order is on its way. Expected delivery: ${order.estimatedDelivery}`,
    }),
  }
}

await notifications.send(user, orderShipped(order))
```

## Notifying multiple users

```ts
await notifications.sendToMany(users, orderShipped(order))
```

## Channel routing

Each notification can specify which channels to use, and the system dispatches only to configured channels:

```ts
await notifications.send(user, {
  mail: { subject: 'Heads up', text: 'Something happened.' },
  // sms and push will be skipped if not configured
})
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `channels.mail` | `MailInstance` | — | Mail instance for email notifications |
| `channels.sms` | `SmsDriver` | — | SMS driver for text notifications |
| `channels.push` | `PushDriver` | — | Push notification driver |
| `queue` | `QueueInstance` | — | Optional queue for async delivery |
