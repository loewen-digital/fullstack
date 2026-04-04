import type { MailConfig } from '../config/types.js'
import type { MailDriver, MailInstance, MailMessage } from './types.js'
import { MailError } from '../errors/http-errors.js'
import { createConsoleDriver } from './drivers/console.js'
import { renderTemplate } from './template.js'

export type { MailConfig, MailDriver, MailInstance, MailMessage, MailAddress, MailAttachment } from './types.js'
export { createConsoleDriver } from './drivers/console.js'
export { createSmtpDriver } from './drivers/smtp.js'
export { createResendDriver } from './drivers/resend.js'
export { createPostmarkDriver } from './drivers/postmark.js'
export { renderTemplate } from './template.js'

/**
 * Create a mail sender instance.
 *
 * Usage:
 *   const mail = createMail({ driver: 'console', from: 'noreply@example.com' })
 *   await mail.send({ to: 'user@example.com', subject: 'Hello', text: 'Hi!' })
 */
export function createMail(config: MailConfig): MailInstance {
  let driver: MailDriver & { sent?: MailMessage[] }

  if (config.driver === 'console') {
    driver = createConsoleDriver({ silent: config.silent as boolean | undefined })
  } else if (config.driver === 'smtp') {
    throw new MailError(
      'SMTP mail driver requires configuration. ' +
        'Import createSmtpDriver from @loewen-digital/fullstack/mail and pass your SMTP options.',
    )
  } else if (config.driver === 'resend') {
    throw new MailError(
      'Resend mail driver requires an API key. ' +
        'Import createResendDriver from @loewen-digital/fullstack/mail and pass your API key.',
    )
  } else if (config.driver === 'postmark') {
    throw new MailError(
      'Postmark mail driver requires a server token. ' +
        'Import createPostmarkDriver from @loewen-digital/fullstack/mail and pass your server token.',
    )
  } else if (typeof config.driver === 'object') {
    driver = config.driver as MailDriver
  } else {
    throw new MailError(`Unknown mail driver: "${config.driver}"`)
  }

  return createMailInstance(driver, config)
}

/**
 * Low-level factory: create a mail instance from any MailDriver.
 * Use this when you need to supply a pre-configured driver.
 */
export function createMailInstance(driver: MailDriver & { sent?: MailMessage[] }, config: MailConfig = { driver: 'console' }): MailInstance {
  return {
    async send(message: MailMessage): Promise<void> {
      // Apply default `from` if not set on the message
      const msg = config.from && !message.from
        ? { ...message, from: config.from }
        : message

      await driver.send(msg)
    },

    render(template: string, variables?: Record<string, unknown>): string {
      return renderTemplate(template, variables)
    },

    get sent(): MailMessage[] {
      return driver.sent ?? []
    },
  }
}
