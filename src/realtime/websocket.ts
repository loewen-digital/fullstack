import type { Channel, ChannelSubscriber, RealtimeEvent } from './types.js'

/**
 * In-process Channel implementation.
 *
 * Channels are the rooms that pub/sub subscribers join.
 * Each subscriber gets a `send()` callback — for SSE connections this calls
 * `sseConn.send()`; for WebSocket connections it calls `ws.send()`.
 *
 * This implementation is intentionally runtime-agnostic: it does not depend
 * on any WebSocket library. Callers supply the send function when subscribing,
 * so the channel works with any WebSocket API (ws, uWebSockets.js, native
 * Bun/Deno WebSocket, etc.).
 */
export function createChannel(name: string): Channel {
  const subscribers = new Map<string, ChannelSubscriber>()

  return {
    name,

    subscribe(subscriber: ChannelSubscriber): void {
      subscribers.set(subscriber.id, subscriber)
    },

    unsubscribe(subscriberId: string): void {
      subscribers.delete(subscriberId)
    },

    broadcast(event: string, data: unknown): void {
      const msg: RealtimeEvent = { event, data }
      for (const subscriber of subscribers.values()) {
        try {
          subscriber.send(msg)
        } catch {
          // Remove broken subscribers silently
          subscribers.delete(subscriber.id)
        }
      }
    },

    get size(): number {
      return subscribers.size
    },
  }
}
