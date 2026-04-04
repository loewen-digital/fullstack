/**
 * Fake mail driver — captures sent messages in-memory instead of delivering them.
 *
 * Usage:
 *   const fakeMail = createFakeMailDriver()
 *   const mail = createMailInstance(fakeMail)
 *
 *   await mail.send({ to: 'user@example.com', subject: 'Hello', text: 'Hi!' })
 *   expect(fakeMail.sent).toHaveLength(1)
 *   expect(fakeMail.lastSent()?.subject).toBe('Hello')
 *   fakeMail.clear()
 */

import type { MailDriver, MailMessage } from '../mail/index.js'

export interface FakeMailDriver extends MailDriver {
  /** All messages sent since creation or last clear() */
  readonly sent: MailMessage[]
  /** The most recently sent message, or undefined if none */
  lastSent(): MailMessage | undefined
  /** Assert a message was sent to a specific address */
  sentTo(address: string): MailMessage[]
  /** Assert a message was sent with a specific subject */
  sentWithSubject(subject: string): MailMessage[]
  /** Clear all captured messages */
  clear(): void
}

export function createFakeMailDriver(): FakeMailDriver {
  const sent: MailMessage[] = []

  function normalizeAddresses(addr: MailMessage['to']): string[] {
    if (!addr) return []
    const list = Array.isArray(addr) ? addr : [addr]
    return list.map(a => (typeof a === 'string' ? a : a.email))
  }

  return {
    sent,

    async send(message: MailMessage): Promise<void> {
      sent.push(message)
    },

    lastSent(): MailMessage | undefined {
      return sent[sent.length - 1]
    },

    sentTo(address: string): MailMessage[] {
      return sent.filter(m => {
        const recipients = [
          ...normalizeAddresses(m.to),
          ...(m.cc ? normalizeAddresses(m.cc) : []),
          ...(m.bcc ? normalizeAddresses(m.bcc) : []),
        ]
        return recipients.some(r => r === address)
      })
    },

    sentWithSubject(subject: string): MailMessage[] {
      return sent.filter(m => m.subject === subject)
    },

    clear(): void {
      sent.length = 0
    },
  }
}
