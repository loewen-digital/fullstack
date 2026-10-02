import { corsHeaders } from '../security/cors.js'
import type { RateLimitResult } from '../security/types.js'
import type { FeedbackEntry, FeedbackHandler, FeedbackHandlerConfig } from './types.js'

export type {
  FeedbackEntry,
  FeedbackHandler,
  FeedbackHandlerConfig,
  FeedbackKvNamespace,
  FeedbackSink,
  GithubIssueSinkConfig,
  KvSinkConfig,
} from './types.js'
export { defuse, formatIssue, githubIssueSink } from './github.js'
export { kvSink } from './kv.js'

function defaultClientKey(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

function clamp(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, max)
  return text === '' ? null : text
}

/**
 * Create the handler of a feedback endpoint: it takes the form's POST, checks it and hands the
 * message to a sink. Public and without accounts, so it limits what a stranger can do: a
 * honeypot field, size limits, a rate limit per client.
 *
 * The form posts JSON: `{ message, contact?, meta?, website }`. `website` is the honeypot: hidden
 * from people, filled in by bots, and a filled-in one is answered with `{ ok: true }` and dropped.
 *
 * Usage (a Cloudflare Pages Function; a SvelteKit `+server.ts` passes `event.request`):
 *   export const onRequest = ({ request, env }) =>
 *     createFeedbackHandler({
 *       sink: githubIssueSink({ repo: 'acme/app', token: env.FEEDBACK_GITHUB_TOKEN }),
 *       fallback: kvSink({ namespace: env.FEEDBACK }),
 *       rateLimiter: createKvRateLimiter({ namespace: env.FEEDBACK, windowMs: 3_600_000, max: 5 }),
 *     })(request)
 *
 * Answers: 200 `{ ok: true }`, 400 (no JSON object, no message), 405, 413 (too long), 429 (rate
 * limit, or the limiter failed), 502 (no sink took the message).
 */
export function createFeedbackHandler(config: FeedbackHandlerConfig): FeedbackHandler {
  const maxMessage = config.maxMessageLength ?? 4000
  const maxContact = config.maxContactLength ?? 200
  const maxMeta = config.maxMetaLength ?? 1000
  // A character takes up to four bytes in UTF-8; the rest is the JSON around the fields.
  const maxBody = (maxMessage + maxContact + maxMeta) * 4 + 1024
  const clientKey = config.clientKey ?? defaultClientKey
  const report =
    config.onError ?? ((error: unknown) => console.error('feedback: delivery failed', error))

  return async function handleFeedback(request: Request): Promise<Response> {
    const cors = config.cors
      ? corsHeaders(request.headers.get('Origin'), {
          methods: ['POST', 'OPTIONS'],
          allowedHeaders: ['Content-Type'],
          ...config.cors,
        })
      : new Headers()
    const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response => {
      const headers = new Headers(cors)
      headers.set('Content-Type', 'application/json')
      for (const [name, value] of Object.entries(extra)) headers.set(name, value)
      return new Response(JSON.stringify(body), { status, headers })
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') {
      return json(405, { error: 'method not allowed' }, { Allow: 'POST, OPTIONS' })
    }
    if (Number(request.headers.get('Content-Length') ?? '0') > maxBody) {
      return json(413, { error: 'body too large' })
    }

    let body: Record<string, unknown>
    try {
      const text = await request.text()
      if (text.length > maxBody) return json(413, { error: 'body too large' })
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return json(400, { error: 'invalid json' })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return json(400, { error: 'invalid json' })
    }

    // Honeypot: people do not see the field. A filled-in one gets the answer a person would get.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json(200, { ok: true })
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (message === '') return json(400, { error: 'message required' })
    if (message.length > maxMessage) return json(413, { error: 'message too long' })

    if (config.rateLimiter) {
      let result: RateLimitResult
      try {
        result = await config.rateLimiter.check(clientKey(request))
      } catch {
        // A limiter that cannot count (KV refuses a second write within a second) lets nothing by.
        result = { allowed: false }
      }
      if (!result.allowed) {
        const seconds = result.resetAt
          ? Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))
          : undefined
        return json(
          429,
          { error: 'too many requests' },
          seconds === undefined ? {} : { 'Retry-After': String(seconds) },
        )
      }
    }

    const entry: FeedbackEntry = {
      receivedAt: new Date().toISOString(),
      message,
      contact: config.includeContact ? clamp(body.contact, maxContact) : null,
      meta: clamp(body.meta, maxMeta),
    }

    try {
      await config.sink.deliver(entry)
    } catch (error) {
      report(error)
      if (!config.fallback) return json(502, { error: 'delivery failed' })
      try {
        await config.fallback.deliver(entry)
      } catch (fallbackError) {
        report(fallbackError)
        return json(502, { error: 'delivery failed' })
      }
    }
    return json(200, { ok: true })
  }
}
