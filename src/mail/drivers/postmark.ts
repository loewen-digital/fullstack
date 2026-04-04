import type { MailDriver, MailMessage, MailAddress } from '../types.js'
import { MailError } from '../../errors/http-errors.js'

export interface PostmarkDriverOptions {
  serverToken: string
  baseUrl?: string
}

/**
 * Postmark driver — sends email via the Postmark REST API.
 * No external dependencies required (uses fetch).
 */
export function createPostmarkDriver(options: PostmarkDriverOptions): MailDriver {
  const baseUrl = options.baseUrl ?? 'https://api.postmarkapp.com'

  return {
    async send(message: MailMessage): Promise<void> {
      const body: Record<string, unknown> = {
        From: formatAddress(message.from) ?? '',
        To: toArray(message.to).map(a => formatAddress(a)).join(', '),
        Subject: message.subject,
      }

      if (message.cc) body.Cc = toArray(message.cc).map(a => formatAddress(a)).join(', ')
      if (message.bcc) body.Bcc = toArray(message.bcc).map(a => formatAddress(a)).join(', ')
      if (message.replyTo) body.ReplyTo = formatAddress(message.replyTo)
      if (message.text) body.TextBody = message.text
      if (message.html) body.HtmlBody = message.html

      if (message.attachments?.length) {
        body.Attachments = message.attachments.map(a => ({
          Name: a.filename,
          Content: typeof a.content === 'string' ? btoa(a.content) : '',
          ContentType: a.contentType ?? 'application/octet-stream',
        }))
      }

      const response = await fetch(`${baseUrl}/email`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': options.serverToken,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error')
        throw new MailError(`Postmark API error (${response.status}): ${text}`)
      }
    },
  }
}

function formatAddress(addr: string | MailAddress | undefined): string | undefined {
  if (!addr) return undefined
  if (typeof addr === 'string') return addr
  return addr.name ? `"${addr.name}" <${addr.email}>` : addr.email
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value]
}
