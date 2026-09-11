---
title: Mail
description: One send() on console, SMTP, Resend or Postmark, with a small HTML template renderer
---

# Mail

`createMail` sends `MailMessage`s through a driver. The console driver prints messages and keeps them for tests; SMTP, Resend and Postmark are built with their own factories and handed to `createMailInstance`. The instance adds a default `from`, `render` for HTML templates, and `sent` for what the console driver captured.

## Import

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
```

## Basic usage

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({ driver: 'console', from: 'My App <hello@example.com>' })

async function welcome(email: string) {
  await mail.send({
    to: email,
    subject: 'Welcome to My App',
    text: 'Thanks for signing up!',
    html: '<p>Thanks for signing up!</p>',
  })
}
```

## Messages

`to`, `cc` and `bcc` take one address or a list; an address is a string (`'alice@example.com'`, `'Alice <alice@example.com>'`) or `{ name, email }`. `from` on the message wins over the instance default. Attachments carry `content` as a string, `Uint8Array` or `ReadableStream`.

```ts
async function invoice(email: string, pdf: Uint8Array) {
  await mail.send({
    to: [{ name: 'Alice', email }, 'bob@example.com'],
    cc: 'manager@example.com',
    bcc: 'archive@example.com',
    replyTo: 'billing@example.com',
    subject: 'Your invoice',
    text: 'Please find your invoice attached.',
    attachments: [{ filename: 'invoice-2026-04.pdf', content: pdf, contentType: 'application/pdf' }],
  })
}
```

## Templates

`render(template, variables)` replaces `{{ name }}` and `{{ user.name }}` with HTML-escaped values and `{{{ html }}}` with the raw value; missing variables become empty strings. `renderTemplate` is the same function without an instance. Loading template files is yours (`readFile`, an import, a string).

```ts
const template = '<h1>Hello {{ user.name }}</h1>{{{ body }}}'

async function newsletter(email: string, body: string) {
  await mail.send({
    to: email,
    subject: 'News',
    html: mail.render(template, { user: { name: 'Alice <admin>' }, body }), // name is escaped, body is not
  })
}
```

## Drivers

The console driver needs nothing and is the one to use in development and tests: every message is logged (unless `silent`), listed in the [Dev UI](/tooling/dev-ui) outside production, and pushed to `mail.sent`.

```ts
import { createMailInstance, createSmtpDriver, createResendDriver, createPostmarkDriver } from '@loewen-digital/fullstack/mail'

const from = 'My App <hello@example.com>'

const viaResend = createMailInstance(createResendDriver({ apiKey: process.env.RESEND_API_KEY! }), { driver: 'resend', from })

const viaPostmark = createMailInstance(createPostmarkDriver({ serverToken: process.env.POSTMARK_TOKEN! }), {
  driver: 'postmark',
  from,
})

const viaSmtp = createMailInstance(
  createSmtpDriver({
    host: process.env.SMTP_HOST!,
    port: 587,
    secure: false,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  }),
  { driver: 'smtp', from },
)
```

| Driver | Options | Needs |
|---|---|---|
| `console` (`createMail({ driver: 'console' })`) | `silent` | nothing |
| `createSmtpDriver({ host, port, secure?, auth? })` | any SMTP server | `npm install nodemailer`, imported on first send |
| `createResendDriver({ apiKey, baseUrl? })` | Resend's REST API through `fetch` | an API key |
| `createPostmarkDriver({ serverToken, baseUrl? })` | Postmark's REST API through `fetch` | a server token |

A custom driver is an object with `send(message)`; pass it to `createMailInstance`.

## Testing

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

async function sendsTheInvoice() {
  const mail = createMail({ driver: 'console', silent: true })
  await mail.send({ to: 'alice@example.com', subject: 'Your invoice', text: '...' })
  return mail.sent.length === 1 && mail.sent[0]?.subject === 'Your invoice'
}
```

`sent` is empty for every other driver; `createFakeMailDriver` from `@loewen-digital/fullstack/testing` captures the same way.

## Config options

`createMail(config)` and the second argument of `createMailInstance(driver, config)` read these.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'console'` | — | Naming `smtp`, `resend` or `postmark` in `createMail` throws and points to the driver factory |
| `from` | `string` | none | Sender for messages without their own `from` |
| `silent` | `boolean` | `false` | Console driver: keep messages in `sent` without logging them |
