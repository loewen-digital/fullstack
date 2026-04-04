import type { MailDriver, MailMessage, MailAddress } from '../types.js'
import { MailError } from '../../errors/http-errors.js'

export interface ResendDriverOptions {
  apiKey: string
  baseUrl?: string
}

/**
 * Resend driver — sends email via the Resend REST API.
 * No external dependencies required (uses fetch).
 */
export function createResendDriver(options: ResendDriverOptions): MailDriver {
  const baseUrl = options.baseUrl ?? 'https://api.resend.com'

  return {
    async send(message: MailMessage): Promise<void> {
      const body = {
        from: formatAddress(message.from),
        to: toArray(message.to).map(a => formatAddress(a)),
        cc: message.cc ? toArray(message.cc).map(a => formatAddress(a)) : undefined,
        bcc: message.bcc ? toArray(message.bcc).map(a => formatAddress(a)) : undefined,
        reply_to: message.replyTo ? formatAddress(message.replyTo) : undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }

      const response = await fetch(`${baseUrl}/emails`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error')
        throw new MailError(`Resend API error (${response.status}): ${text}`)
      }
    },
  }
}

function formatAddress(addr: string | MailAddress | undefined): string | undefined {
  if (!addr) return undefined
  if (typeof addr === 'string') return addr
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
