import type { MailDriver, MailMessage } from '../types.js'
import { devStorePushMail, isDevMode } from '../../dev-store/index.js'

export interface ConsoleDriverOptions {
  /** If true, suppress console.log output (useful for testing) */
  silent?: boolean
}

export function createConsoleDriver(options: ConsoleDriverOptions = {}): MailDriver & { sent: MailMessage[] } {
  const sent: MailMessage[] = []

  return {
    sent,

    async send(message: MailMessage): Promise<void> {
      sent.push(message)

      if (isDevMode()) {
        devStorePushMail({
          timestamp: new Date().toISOString(),
          to: formatAddresses(message.to),
          subject: message.subject,
          from: message.from ? formatAddresses(message.from) : '',
          cc: message.cc ? formatAddresses(message.cc) : undefined,
          bcc: message.bcc ? formatAddresses(message.bcc) : undefined,
          text: message.text,
          html: message.html,
        })
      }

      if (!options.silent) {
        console.log('--- Mail Sent ---')
        console.log(`To:      ${formatAddresses(message.to)}`)
        console.log(`Subject: ${message.subject}`)
        if (message.from) console.log(`From:    ${formatAddresses(message.from)}`)
        if (message.cc) console.log(`Cc:      ${formatAddresses(message.cc)}`)
        if (message.bcc) console.log(`Bcc:     ${formatAddresses(message.bcc)}`)
        if (message.text) console.log(`\n${message.text}`)
        if (message.html) console.log(`\n[HTML]: ${message.html.slice(0, 200)}...`)
        console.log('-----------------')
      }
    },
  }
}

function formatAddresses(addr: string | { name?: string; email: string } | Array<string | { name?: string; email: string }>): string {
  if (typeof addr === 'string') return addr
  if (Array.isArray(addr)) return addr.map(a => formatAddresses(a)).join(', ')
  return addr.name ? `${addr.name} <${addr.email}>` : addr.email
}
