import type { DeliveryResult, OutgoingWebhook, WebhooksConfig } from './types.js'
import { signPayload } from './incoming.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Send an outgoing webhook with exponential-backoff retry.
 * Signs the payload with HMAC-SHA256 if a secret is configured.
 */
export async function sendOutgoingWebhook(
  webhook: OutgoingWebhook,
  config: WebhooksConfig,
): Promise<DeliveryResult> {
  const maxRetries = config.maxRetries ?? 3
  const baseDelay = config.retryDelay ?? 1000

  const body = JSON.stringify(webhook.payload)

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': webhook.event,
    ...webhook.headers,
  }

  if (config.secret) {
    const sig = await signPayload(body, config.secret)
    headers['X-Webhook-Signature'] = `sha256=${sig}`
  }

  let lastError: string | undefined
  let attempts = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++
    try {
      const res = await fetch(webhook.url, { method: 'POST', headers, body })
      if (res.ok) {
        return { ok: true, status: res.status, attempts }
      }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    // Don't sleep after the last attempt
    if (attempt < maxRetries) {
      await sleep(baseDelay * Math.pow(2, attempt))
    }
  }

  return { ok: false, error: lastError, attempts }
}
