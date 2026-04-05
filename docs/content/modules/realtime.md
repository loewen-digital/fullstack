---
title: Realtime
description: WebSocket and Server-Sent Events helpers for live updates
---

# Realtime

The `realtime` module provides helpers for pushing live updates to connected clients via WebSockets or Server-Sent Events (SSE). It integrates with your existing meta-framework server without requiring a separate process.

## Import

```ts
import { createRealtime } from '@loewen-digital/fullstack/realtime'
```

## Server-Sent Events (SSE)

SSE is the simplest approach for one-way server-to-client updates (notifications, live feeds, progress bars):

```ts
import { createRealtime } from '@loewen-digital/fullstack/realtime'

const realtime = createRealtime({ driver: 'sse' })

// In your SSE endpoint handler (returns a Web Standard Response):
export async function GET(request: Request) {
  const { response, stream } = realtime.sse(request)

  // Send events from anywhere in your app
  stream.send({ event: 'notification', data: { message: 'You have a new message' } })

  return response
}
```

## Publishing to SSE clients

```ts
// Broadcast to all connected clients
await realtime.broadcast({ event: 'update', data: latestData })

// Send to a specific user's connections
await realtime.sendTo(userId, { event: 'order-update', data: order })
```

## WebSocket support

```ts
const realtime = createRealtime({ driver: 'websocket' })

// Handle an upgrade request
export async function GET(request: Request) {
  return realtime.upgrade(request, {
    onMessage: async (socket, message) => {
      const data = JSON.parse(message)
      await socket.send(JSON.stringify({ echo: data }))
    },
    onClose: (socket) => {
      console.log('Client disconnected')
    },
  })
}
```

## Channels

Organize connections into named channels for targeted broadcasts:

```ts
// Client subscribes to a channel (sent as a message)
// Server-side handling:
realtime.channel('orders', {
  onJoin: async (socket, userId) => {
    await realtime.sendTo(socket, { event: 'connected', data: { channel: 'orders' } })
  },
})

// Broadcast to everyone in a channel
await realtime.toChannel('orders').broadcast({ event: 'new-order', data: order })
```

## Driver options

| Driver | Description |
|---|---|
| `sse` | Server-Sent Events. One-way, text-based, built on standard HTTP. |
| `websocket` | Full-duplex WebSocket connections. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'sse' \| 'websocket'` | `'sse'` | Transport driver |
| `heartbeat` | `number` | `30000` | Heartbeat interval in milliseconds |
| `maxConnections` | `number` | `10000` | Maximum concurrent connections |
