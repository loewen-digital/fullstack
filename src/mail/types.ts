import type { MailConfig } from '../config/types.js'

export type { MailConfig }

export interface MailAddress {
  name?: string
  email: string
}

export interface MailAttachment {
  filename: string
  content: string | Uint8Array | ReadableStream
  contentType?: string
}

export interface MailMessage {
  to: string | MailAddress | Array<string | MailAddress>
  from?: string | MailAddress
  cc?: string | MailAddress | Array<string | MailAddress>
  bcc?: string | MailAddress | Array<string | MailAddress>
  replyTo?: string | MailAddress
  subject: string
  text?: string
  html?: string
  attachments?: MailAttachment[]
}

export interface MailDriver {
  send(message: MailMessage): Promise<void>
}

export interface MailInstance {
  /** Send an email immediately */
  send(message: MailMessage): Promise<void>
  /** Render an HTML template with variables */
  render(template: string, variables?: Record<string, unknown>): string
  /** Get captured messages (console driver only) */
  readonly sent: MailMessage[]
}
