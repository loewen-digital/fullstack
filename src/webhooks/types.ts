export interface WebhooksConfig {
  /** Default signing secret for outgoing webhooks */
  secret?: string
  /** Maximum number of delivery retries for outgoing webhooks */
  maxRetries?: number
  /** Initial retry delay in ms (doubles each retry) */
  retryDelay?: number
}

// ── Incoming ─────────────────────────────────────────────────────────────────

export type SignatureAlgorithm = 'hmac-sha256' | 'hmac-sha1'

export interface IncomingVerifyOptions {
  /** HMAC secret */
  secret: string
  /** Header that contains the signature (e.g. 'x-hub-signature-256') */
  header: string
  /** Algorithm to use */
  algorithm?: SignatureAlgorithm
  /**
   * Prefix to strip from the header value before comparing
   * (e.g. GitHub sends 'sha256=<hex>', so prefix is 'sha256=')
   */
  prefix?: string
}

export interface IncomingVerifyResult {
  valid: boolean
  reason?: string
}

// ── Outgoing ─────────────────────────────────────────────────────────────────

export interface OutgoingWebhook {
  url: string
  event: string
  payload: Record<string, unknown>
  headers?: Record<string, string>
}

export interface DeliveryResult {
  ok: boolean
  status?: number
  attempts: number
  error?: string
}

export interface OutgoingWebhookLog {
  id: string
  url: string
  event: string
  payload: Record<string, unknown>
  result: DeliveryResult
  deliveredAt: Date
}

// ── Instance ─────────────────────────────────────────────────────────────────

export interface WebhooksInstance {
  /**
   * Verify the signature of an incoming webhook request.
   * Reads the raw body and the specified header.
   */
  verify(request: Request, options: IncomingVerifyOptions): Promise<IncomingVerifyResult>

  /**
   * Send an outgoing webhook with automatic retry on failure.
   */
  send(webhook: OutgoingWebhook): Promise<DeliveryResult>

  /**
   * Get the delivery log for all outgoing webhooks (in-memory).
   */
  getLogs(): OutgoingWebhookLog[]
}
