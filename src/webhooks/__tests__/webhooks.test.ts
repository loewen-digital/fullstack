import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWebhooks, signPayload, verifyIncomingWebhook } from '../index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/hook', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function signedRequest(body: string, secret: string, prefix = 'sha256='): Promise<Request> {
  const sig = await signPayload(body, secret)
  return makeRequest(body, { 'x-hub-signature-256': `${prefix}${sig}` })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createWebhooks', () => {
  it('creates a webhooks instance', () => {
    const wh = createWebhooks()
    expect(wh.verify).toBeInstanceOf(Function)
    expect(wh.send).toBeInstanceOf(Function)
    expect(wh.getLogs).toBeInstanceOf(Function)
  })
})

describe('signPayload / verifyIncomingWebhook', () => {
  const secret = 'my-webhook-secret'
  const body = JSON.stringify({ event: 'order.created', orderId: '123' })

  it('signs and verifies a payload', async () => {
    const sig = await signPayload(body, secret)
    const req = makeRequest(body, { 'x-signature': sig })
    const result = await verifyIncomingWebhook(req, { secret, header: 'x-signature' })
    expect(result.valid).toBe(true)
  })

  it('verifies with prefix (GitHub style)', async () => {
    const req = await signedRequest(body, secret, 'sha256=')
    const result = await verifyIncomingWebhook(req, {
      secret,
      header: 'x-hub-signature-256',
      prefix: 'sha256=',
    })
    expect(result.valid).toBe(true)
  })

  it('returns invalid for wrong signature', async () => {
    const req = makeRequest(body, { 'x-signature': 'deadbeef' })
    const result = await verifyIncomingWebhook(req, { secret, header: 'x-signature' })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/mismatch/i)
  })

  it('returns invalid for missing header', async () => {
    const req = makeRequest(body)
    const result = await verifyIncomingWebhook(req, { secret, header: 'x-signature' })
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/missing/i)
  })

  it('returns invalid for wrong secret', async () => {
    const req = await signedRequest(body, 'correct-secret', 'sha256=')
    const result = await verifyIncomingWebhook(req, {
      secret: 'wrong-secret',
      header: 'x-hub-signature-256',
      prefix: 'sha256=',
    })
    expect(result.valid).toBe(false)
  })

  it('supports HMAC-SHA1', async () => {
    const sig = await signPayload(body, secret, 'hmac-sha1')
    const req = makeRequest(body, { 'x-hub-signature': `sha1=${sig}` })
    const result = await verifyIncomingWebhook(req, {
      secret,
      header: 'x-hub-signature',
      algorithm: 'hmac-sha1',
      prefix: 'sha1=',
    })
    expect(result.valid).toBe(true)
  })
})

describe('verify() on instance', () => {
  it('delegates to verifyIncomingWebhook', async () => {
    const wh = createWebhooks({ secret: 'sec' })
    const body = '{"x":1}'
    const sig = await signPayload(body, 'sec')
    const req = makeRequest(body, { 'x-sig': sig })
    const result = await wh.verify(req, { secret: 'sec', header: 'x-sig' })
    expect(result.valid).toBe(true)
  })
})

describe('send() outgoing webhooks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a POST request to the webhook URL', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const wh = createWebhooks()
    const result = await wh.send({
      url: 'https://example.com/hook',
      event: 'order.created',
      payload: { orderId: '1' },
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.attempts).toBe(1)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('includes X-Webhook-Event header', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const wh = createWebhooks()
    await wh.send({ url: 'https://x.com/hook', event: 'ping', payload: {} })

    const [, init] = mockFetch.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Webhook-Event']).toBe('ping')
  })

  it('signs the request when secret is configured', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const wh = createWebhooks({ secret: 'my-secret' })
    await wh.send({ url: 'https://x.com/hook', event: 'ping', payload: { x: 1 } })

    const [, init] = mockFetch.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=/)
  })

  it('retries on failure and eventually returns ok:false', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('network error'))

    const wh = createWebhooks({ maxRetries: 2, retryDelay: 0 })
    const result = await wh.send({ url: 'https://x.com/hook', event: 'ping', payload: {} })

    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(3) // 1 initial + 2 retries
    expect(result.error).toContain('network error')
  })

  it('stops retrying after a successful attempt', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const wh = createWebhooks({ maxRetries: 3, retryDelay: 0 })
    const result = await wh.send({ url: 'https://x.com/hook', event: 'ping', payload: {} })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
  })

  it('logs deliveries', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))

    const wh = createWebhooks()
    await wh.send({ url: 'https://x.com/hook', event: 'a', payload: { n: 1 } })
    await wh.send({ url: 'https://x.com/hook', event: 'b', payload: { n: 2 } })

    const logs = wh.getLogs()
    expect(logs).toHaveLength(2)
    expect(logs[0]!.event).toBe('a')
    expect(logs[1]!.event).toBe('b')
    expect(logs[0]!.result.ok).toBe(true)
  })
})
