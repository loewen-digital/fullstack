import type { MailDriver, MailMessage, MailAddress } from '../types.js'
import { MailError } from '../../errors/http-errors.js'

export interface SmtpDriverOptions {
  host: string
  port: number
  secure?: boolean
  auth?: {
    user: string
    pass: string
  }
}

/**
 * SMTP driver using nodemailer.
 *
 * Requires `nodemailer` as a peer dependency.
 * Install: `npm install nodemailer`
 */
export function createSmtpDriver(options: SmtpDriverOptions): MailDriver {
  let transporter: unknown

  async function getTransporter(): Promise<{ sendMail(opts: unknown): Promise<unknown> }> {
    if (!transporter) {
      try {
        const nodemailer = await (import('nodemailer' as string) as Promise<{ createTransport(opts: unknown): { sendMail(opts: unknown): Promise<unknown> } }>)
        transporter = nodemailer.createTransport({
          host: options.host,
          port: options.port,
          secure: options.secure ?? options.port === 465,
          auth: options.auth,
        })
      } catch {
        throw new MailError('nodemailer is required for the SMTP driver. Install it with: npm install nodemailer')
      }
    }
    return transporter as { sendMail(opts: unknown): Promise<unknown> }
  }

  return {
    async send(message: MailMessage): Promise<void> {
      const transport = await getTransporter()
      try {
        await transport.sendMail({
          from: formatAddress(message.from),
          to: formatAddressList(message.to),
          cc: message.cc ? formatAddressList(message.cc) : undefined,
          bcc: message.bcc ? formatAddressList(message.bcc) : undefined,
          replyTo: message.replyTo ? formatAddress(message.replyTo) : undefined,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments?.map(a => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          })),
        })
      } catch (err) {
        throw new MailError(`Failed to send email via SMTP: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

function formatAddress(addr: string | MailAddress | undefined): string | undefined {
  if (!addr) return undefined
  if (typeof addr === 'string') return addr
  return addr.name ? `"${addr.name}" <${addr.email}>` : addr.email
}

function formatAddressList(addr: string | MailAddress | Array<string | MailAddress>): string | string[] {
  if (Array.isArray(addr)) return addr.map(a => formatAddress(a)!)
  return formatAddress(addr)!
}
