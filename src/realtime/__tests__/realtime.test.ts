import { describe, it, expect } from 'vitest'
import { createRealtime, createChannel, createSseConnection } from '../index.js'
import type { ChannelSubscriber, RealtimeEvent } from '../types.js'

// ── Helper ────────────────────────────────────────────────────────────────────

function makeSub(id: string): { subscriber: ChannelSubscriber; received: RealtimeEvent[] } {
  const received: RealtimeEvent[] = []
  const subscriber: ChannelSubscriber = { id, send: (e) => received.push(e) }
  return { subscriber, received }
}

// ── createRealtime ─────────────────────────────────────────────────────────────

describe('createRealtime', () => {
  it('creates an instance', () => {
    const rt = createRealtime()
    expect(rt.channel).toBeInstanceOf(Function)
    expect(rt.broadcast).toBeInstanceOf(Function)
    expect(rt.sse).toBeInstanceOf(Function)
  })

  it('channel() returns the same channel for the same name', () => {
    const rt = createRealtime()
    const ch1 = rt.channel('chat')
    const ch2 = rt.channel('chat')
    expect(ch1).toBe(ch2)
  })

  it('tracks channelCount', () => {
    const rt = createRealtime()
    expect(rt.channelCount).toBe(0)
    rt.channel('a')
    rt.channel('b')
    expect(rt.channelCount).toBe(2)
  })

  it('broadcast() sends to all subscribers of a channel', () => {
    const rt = createRealtime()
    const { subscriber: s1, received: r1 } = makeSub('s1')
    const { subscriber: s2, received: r2 } = makeSub('s2')
    rt.channel('chat').subscribe(s1)
    rt.channel('chat').subscribe(s2)

    rt.broadcast('chat', 'message', { text: 'hi' })
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r1[0]!.data).toEqual({ text: 'hi' })
  })

  it('broadcast() to non-existent channel does nothing', () => {
    const rt = createRealtime()
    expect(() => rt.broadcast('ghost', 'ping', {})).not.toThrow()
  })
})

// ── Channel ────────────────────────────────────────────────────────────────────

describe('Channel', () => {
  it('subscribe and unsubscribe', () => {
    const ch = createChannel('test')
    const { subscriber, received } = makeSub('s1')
    ch.subscribe(subscriber)
    expect(ch.size).toBe(1)

    ch.broadcast('ping', {})
    expect(received).toHaveLength(1)

    ch.unsubscribe('s1')
    expect(ch.size).toBe(0)

    ch.broadcast('ping', {})
    expect(received).toHaveLength(1) // no new message
  })

  it('broadcasts event name and data', () => {
    const ch = createChannel('feed')
    const { subscriber, received } = makeSub('s1')
    ch.subscribe(subscriber)
    ch.broadcast('update', { count: 5 })
    expect(received[0]!.event).toBe('update')
    expect(received[0]!.data).toEqual({ count: 5 })
  })

  it('handles multiple subscribers independently', () => {
    const ch = createChannel('news')
    const { subscriber: s1, received: r1 } = makeSub('a')
    const { subscriber: s2, received: r2 } = makeSub('b')
    ch.subscribe(s1)
    ch.subscribe(s2)

    ch.broadcast('news', 'breaking')
    ch.unsubscribe('a')
    ch.broadcast('news', 'latest')

    expect(r1).toHaveLength(1) // only received first
    expect(r2).toHaveLength(2) // received both
  })

  it('silently removes broken subscribers', () => {
    const ch = createChannel('test')
    const broken: ChannelSubscriber = { id: 'broken', send: () => { throw new Error('broken') } }
    ch.subscribe(broken)
    expect(ch.size).toBe(1)
    expect(() => ch.broadcast('ping', {})).not.toThrow()
    expect(ch.size).toBe(0) // removed after error
  })
})

// ── SSE ────────────────────────────────────────────────────────────────────────

describe('SSE', () => {
  it('createSseConnection returns a Response and send/close functions', () => {
    const conn = createSseConnection()
    expect(conn.response).toBeInstanceOf(Response)
    expect(conn.send).toBeInstanceOf(Function)
    expect(conn.close).toBeInstanceOf(Function)
  })

  it('response has correct SSE headers', () => {
    const conn = createSseConnection()
    expect(conn.response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(conn.response.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('send() streams SSE-formatted data', async () => {
    const conn = createSseConnection()
    conn.send('message', { text: 'hello' })
    conn.close()

    const text = await conn.response.text()
    expect(text).toContain('event: message')
    expect(text).toContain('data: {"text":"hello"}')
  })

  it('send() includes id when provided', async () => {
    const conn = createSseConnection()
    conn.send('update', 'payload', 'evt-123')
    conn.close()

    const text = await conn.response.text()
    expect(text).toContain('id: evt-123')
  })

  it('send() after close is a no-op', () => {
    const conn = createSseConnection()
    conn.close()
    expect(() => conn.send('ping', {})).not.toThrow()
  })

  it('realtime.sse() returns a connection', () => {
    const rt = createRealtime()
    const conn = rt.sse()
    expect(conn.response).toBeInstanceOf(Response)
  })

  it('integrates SSE with channel broadcast', async () => {
    const rt = createRealtime()
    const conn = rt.sse()

    rt.channel('feed').subscribe({
      id: 'client-1',
      send: (e) => conn.send(e.event, e.data),
    })

    rt.broadcast('feed', 'update', { count: 42 })
    conn.close()

    const text = await conn.response.text()
    expect(text).toContain('event: update')
    expect(text).toContain('"count":42')
  })
})
