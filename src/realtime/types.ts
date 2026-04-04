export interface RealtimeConfig {
  /** Default ping interval in ms (WebSocket keepalive) */
  pingInterval?: number
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface RealtimeEvent {
  event: string
  data: unknown
  id?: string
}

// ── Channel ───────────────────────────────────────────────────────────────────

export interface ChannelSubscriber {
  id: string
  send(event: RealtimeEvent): void
}

export interface Channel {
  name: string
  /** Subscribe a client to this channel */
  subscribe(subscriber: ChannelSubscriber): void
  /** Unsubscribe a client */
  unsubscribe(subscriberId: string): void
  /** Broadcast an event to all subscribers */
  broadcast(event: string, data: unknown): void
  /** Number of active subscribers */
  readonly size: number
}

// ── SSE ───────────────────────────────────────────────────────────────────────

export interface SseConnection {
  /** The SSE Response to return from your route handler */
  response: Response
  /** Push an event to the client */
  send(event: string, data: unknown, id?: string): void
  /** Close the connection */
  close(): void
}

// ── Instance ──────────────────────────────────────────────────────────────────

export interface RealtimeInstance {
  /**
   * Get or create a named channel.
   * Channels are the pub/sub rooms clients subscribe to.
   */
  channel(name: string): Channel

  /**
   * Broadcast an event to all subscribers of a channel.
   */
  broadcast(channel: string, event: string, data: unknown): void

  /**
   * Create a Server-Sent Events connection for a client.
   * Returns a Response and a send function.
   *
   * Usage (SvelteKit):
   *   export async function GET({ request }) {
   *     const conn = realtime.sse(request)
   *     realtime.channel('feed').subscribe({ id: crypto.randomUUID(), send: conn.send })
   *     return conn.response
   *   }
   */
  sse(request?: Request): SseConnection

  /** Number of active channels */
  readonly channelCount: number
}
