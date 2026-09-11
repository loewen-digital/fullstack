---
title: Realtime
description: In-process pub/sub channels and Server-Sent Events on a Web Standard Response
---

# Realtime

`createRealtime` gives named channels that fan out events to subscribers, and `sse()` for a Server-Sent Events connection built on `ReadableStream`: a `Response` to return from any route handler plus a `send` to push events into it. A subscriber is `{ id, send }`, so an SSE connection, a WebSocket from your runtime or a test spy all subscribe the same way.

Everything is in one process: a channel lives in the instance, and a broadcast reaches the subscribers of that process or Workers isolate. Fan-out across instances needs a broker of your own.

## Import

```ts
import { createRealtime } from '@loewen-digital/fullstack/realtime'
```

## Channels

`channel(name)` creates the channel on first use. `broadcast(event, data)` sends `{ event, data }` to every subscriber; one whose `send` throws is dropped.

```ts
import { createRealtime } from '@loewen-digital/fullstack/realtime'

export const realtime = createRealtime()

function announce(orderId: string) {
  realtime.broadcast('orders', 'order.created', { orderId }) // no-op when the channel has no subscribers yet
  return realtime.channel('orders').size
}
```

## Server-Sent Events

`sse()` returns `{ response, send, close }`. Return `response` from the handler and keep `send` for the lifetime of the connection; subscribing it to a channel is the usual way. Unsubscribe and close when the client goes away, which `request.signal` reports.

```ts
export function ordersFeed(request: Request): Response {
  const conn = realtime.sse(request)
  const id = crypto.randomUUID()

  realtime.channel('orders').subscribe({ id, send: (e) => conn.send(e.event, e.data, e.id) })
  conn.send('connected', { id })

  request.signal.addEventListener('abort', () => {
    realtime.channel('orders').unsubscribe(id)
    conn.close()
  })

  return conn.response
}
```

The response carries `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`. `send(event, data, id?)` writes an `event:` line, `data:` lines (objects as JSON, strings as they are, one line per newline) and an optional `id:`. In the browser:

```ts
const source = new EventSource('/orders/feed')
source.addEventListener('order.created', (message) => {
  const { orderId } = JSON.parse(message.data) as { orderId: string }
  console.log('new order', orderId)
})
```

## WebSockets

There is no upgrade helper: WebSockets differ per runtime (`ws` on Node, `WebSocketPair` on Workers, native on Bun and Deno). Whatever socket you have subscribes with its own `send`.

```ts
import type { RealtimeEvent } from '@loewen-digital/fullstack/realtime'

function attachSocket(socket: { send(data: string): void; addEventListener(type: 'close', handler: () => void): void }) {
  const id = crypto.randomUUID()
  realtime.channel('orders').subscribe({ id, send: (e: RealtimeEvent) => socket.send(JSON.stringify(e)) })
  socket.addEventListener('close', () => realtime.channel('orders').unsubscribe(id))
}
```

## Standalone functions

`createChannel(name)` and `createSseConnection(request?)` are the building blocks without an instance.

## Config options

`createRealtime(config?)` reads nothing yet: `pingInterval` is declared on `RealtimeConfig` but no keepalive is sent. Send your own `ping` event on a timer if a proxy closes idle connections.

| Property | Description |
|---|---|
| `channel(name)` | Get or create a channel: `subscribe({ id, send })`, `unsubscribe(id)`, `broadcast(event, data)`, `size` |
| `broadcast(channel, event, data)` | Broadcast without fetching the channel; silent when it does not exist |
| `sse(request?)` | `{ response, send(event, data, id?), close() }` |
| `channelCount` | Number of channels created so far |
