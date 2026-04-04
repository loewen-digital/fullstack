import { createChannel } from './websocket.js'
import { createSseConnection } from './sse.js'
import type { Channel, RealtimeConfig, RealtimeInstance, SseConnection } from './types.js'

export type {
  Channel,
  ChannelSubscriber,
  RealtimeConfig,
  RealtimeEvent,
  RealtimeInstance,
  SseConnection,
} from './types.js'
export { createChannel } from './websocket.js'
export { createSseConnection } from './sse.js'

/**
 * Create a realtime instance for pub/sub channels and SSE.
 *
 * Usage:
 *   const realtime = createRealtime()
 *
 *   // Broadcast to a channel
 *   realtime.broadcast('chat', 'message', { text: 'Hello!' })
 *
 *   // SSE endpoint (e.g. SvelteKit GET handler)
 *   const conn = realtime.sse(request)
 *   realtime.channel('feed').subscribe({
 *     id: crypto.randomUUID(),
 *     send: (e) => conn.send(e.event, e.data),
 *   })
 *   return conn.response
 */
export function createRealtime(_config: RealtimeConfig = {}): RealtimeInstance {
  const channels = new Map<string, Channel>()

  return {
    channel(name: string): Channel {
      if (!channels.has(name)) {
        channels.set(name, createChannel(name))
      }
      return channels.get(name)!
    },

    broadcast(channelName: string, event: string, data: unknown): void {
      const ch = channels.get(channelName)
      if (ch) ch.broadcast(event, data)
      // Silently ignore broadcasts to non-existent channels
    },

    sse(request?: Request): SseConnection {
      return createSseConnection(request)
    },

    get channelCount(): number {
      return channels.size
    },
  }
}
