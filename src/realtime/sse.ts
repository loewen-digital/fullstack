import type { RealtimeEvent, SseConnection } from './types.js'

/**
 * Create a Server-Sent Events connection.
 *
 * Uses the Web Streams API (ReadableStream + TransformStream) so it works
 * across Node 20+, Cloudflare Workers, Deno, and Bun without polyfills.
 */
export function createSseConnection(_request?: Request): SseConnection {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  const encoder = new TextEncoder()

  function formatSseMessage(event: RealtimeEvent): string {
    let msg = ''
    if (event.id) msg += `id: ${event.id}\n`
    msg += `event: ${event.event}\n`
    const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
    // Multi-line data support
    for (const line of dataStr.split('\n')) {
      msg += `data: ${line}\n`
    }
    msg += '\n'
    return msg
  }

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      closed = true
      controller = null
    },
  })

  const response = new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  })

  return {
    response,

    send(event: string, data: unknown, id?: string): void {
      if (closed || !controller) return
      try {
        const msg = formatSseMessage({ event, data, id })
        controller.enqueue(encoder.encode(msg))
      } catch {
        closed = true
        controller = null
      }
    },

    close(): void {
      if (closed || !controller) return
      closed = true
      try {
        controller.close()
      } catch {
        // already closed
      }
      controller = null
    },
  }
}
