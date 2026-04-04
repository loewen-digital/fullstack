import { describe, it, expect } from 'vitest'
import { createMail, createMailInstance, createConsoleDriver, renderTemplate } from '../index.js'
import type { MailDriver, MailMessage } from '../types.js'

describe('createMail', () => {
  it('creates instance with console driver', () => {
    const mail = createMail({ driver: 'console', silent: true })
    expect(mail).toBeDefined()
    expect(mail.send).toBeInstanceOf(Function)
    expect(mail.render).toBeInstanceOf(Function)
  })

  it('sends a basic email', async () => {
    const mail = createMail({ driver: 'console', silent: true })
    await mail.send({
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello!',
    })
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0].subject).toBe('Test')
  })

  it('applies default from address', async () => {
    const mail = createMail({ driver: 'console', from: 'noreply@example.com', silent: true })
    await mail.send({
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello!',
    })
    expect(mail.sent[0].from).toBe('noreply@example.com')
  })

  it('does not override explicit from address', async () => {
    const mail = createMail({ driver: 'console', from: 'noreply@example.com', silent: true })
    await mail.send({
      to: 'user@example.com',
      from: 'custom@example.com',
      subject: 'Test',
      text: 'Hello!',
    })
    expect(mail.sent[0].from).toBe('custom@example.com')
  })

  it('sends to multiple recipients', async () => {
    const mail = createMail({ driver: 'console', silent: true })
    await mail.send({
      to: ['a@example.com', { name: 'Bob', email: 'b@example.com' }],
      subject: 'Multi',
      text: 'Hi all!',
    })
    expect(mail.sent).toHaveLength(1)
  })

  it('sends with cc, bcc, and replyTo', async () => {
    const mail = createMail({ driver: 'console', silent: true })
    await mail.send({
      to: 'user@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      replyTo: 'reply@example.com',
      subject: 'Full',
      text: 'All fields',
    })
    const msg = mail.sent[0]
    expect(msg.cc).toBe('cc@example.com')
    expect(msg.bcc).toBe('bcc@example.com')
    expect(msg.replyTo).toBe('reply@example.com')
  })

  it('throws on unknown driver', () => {
    expect(() => createMail({ driver: 'unknown' })).toThrow('Unknown mail driver')
  })

  it('throws on smtp driver without config', () => {
    expect(() => createMail({ driver: 'smtp' })).toThrow('SMTP mail driver requires configuration')
  })

  it('throws on resend driver without config', () => {
    expect(() => createMail({ driver: 'resend' })).toThrow('Resend mail driver requires an API key')
  })

  it('throws on postmark driver without config', () => {
    expect(() => createMail({ driver: 'postmark' })).toThrow('Postmark mail driver requires a server token')
  })
})

describe('createMailInstance', () => {
  it('works with a custom driver', async () => {
    const sent: MailMessage[] = []
    const driver: MailDriver = {
      async send(message) { sent.push(message) },
    }
    const mail = createMailInstance(driver)
    await mail.send({ to: 'a@b.com', subject: 'Custom', text: 'hi' })
    expect(sent).toHaveLength(1)
  })
})

describe('createConsoleDriver', () => {
  it('captures sent messages', async () => {
    const driver = createConsoleDriver({ silent: true })
    await driver.send({ to: 'test@example.com', subject: 'Test', text: 'Hi' })
    expect(driver.sent).toHaveLength(1)
    expect(driver.sent[0].subject).toBe('Test')
  })

  it('accumulates multiple messages', async () => {
    const driver = createConsoleDriver({ silent: true })
    await driver.send({ to: 'a@b.com', subject: 'One', text: '1' })
    await driver.send({ to: 'a@b.com', subject: 'Two', text: '2' })
    expect(driver.sent).toHaveLength(2)
  })
})

describe('renderTemplate', () => {
  it('interpolates simple variables', () => {
    const result = renderTemplate('Hello {{ name }}!', { name: 'World' })
    expect(result).toBe('Hello World!')
  })

  it('interpolates nested variables', () => {
    const result = renderTemplate('{{ user.name }} ({{ user.email }})', {
      user: { name: 'Alice', email: 'alice@example.com' },
    })
    expect(result).toBe('Alice (alice@example.com)')
  })

  it('escapes HTML in double braces', () => {
    const result = renderTemplate('{{ content }}', { content: '<script>alert("xss")</script>' })
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('allows unescaped HTML in triple braces', () => {
    const result = renderTemplate('{{{ content }}}', { content: '<strong>bold</strong>' })
    expect(result).toBe('<strong>bold</strong>')
  })

  it('replaces missing variables with empty string', () => {
    const result = renderTemplate('Hello {{ name }}!', {})
    expect(result).toBe('Hello !')
  })

  it('handles null and undefined values', () => {
    const result = renderTemplate('{{ a }} {{ b }}', { a: null, b: undefined })
    expect(result).toBe(' ')
  })

  it('handles no variables', () => {
    const result = renderTemplate('No variables here')
    expect(result).toBe('No variables here')
  })

  it('handles multiple variables in one template', () => {
    const result = renderTemplate('{{ greeting }}, {{ name }}! Welcome to {{ place }}.', {
      greeting: 'Hi',
      name: 'Bob',
      place: 'Fullstack',
    })
    expect(result).toBe('Hi, Bob! Welcome to Fullstack.')
  })
})
