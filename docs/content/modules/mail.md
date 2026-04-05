---
title: Mail
description: Multi-driver email sending with templates and attachments
---

# Mail

The `mail` module provides a consistent API for sending email regardless of which delivery service you use. Switch between SMTP, Resend, Postmark, or the console driver without changing any of your application code.

## Import

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
```

## Basic usage

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({
  driver: 'smtp',
  from: { name: 'My App', address: 'hello@example.com' },
  smtp: {
    host: process.env.SMTP_HOST!,
    port: 587,
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  },
})

await mail.send({
  to: 'alice@example.com',
  subject: 'Welcome to My App',
  text: 'Thanks for signing up!',
  html: '<p>Thanks for signing up!</p>',
})
```

## Sending to multiple recipients

```ts
await mail.send({
  to: ['alice@example.com', 'bob@example.com'],
  cc: 'manager@example.com',
  bcc: 'archive@example.com',
  subject: 'Team update',
  text: 'Here is the weekly update...',
})
```

## Attachments

```ts
await mail.send({
  to: 'alice@example.com',
  subject: 'Your invoice',
  text: 'Please find your invoice attached.',
  attachments: [
    {
      filename: 'invoice-2026-04.pdf',
      content: pdfBytes, // Uint8Array
      contentType: 'application/pdf',
    },
  ],
})
```

## Development: console driver

Use the `console` driver in development to see emails in your terminal without sending them:

```ts
const mail = createMail({
  driver: process.env.NODE_ENV === 'production' ? 'resend' : 'console',
  from: { name: 'My App', address: 'hello@example.com' },
  resend: { apiKey: process.env.RESEND_API_KEY! },
})
```

## Driver options

| Driver | Description |
|---|---|
| `console` | Prints emails to stdout. No external service needed. |
| `smtp` | Standard SMTP. Works with any SMTP server. |
| `resend` | [Resend](https://resend.com) API. Requires `resend` npm package. |
| `postmark` | [Postmark](https://postmarkapp.com) API. Requires `postmark` npm package. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'console' \| 'smtp' \| 'resend' \| 'postmark'` | — | Mail driver |
| `from.name` | `string` | — | Default sender name |
| `from.address` | `string` | — | Default sender email address |
| `smtp.host` | `string` | — | SMTP server hostname |
| `smtp.port` | `number` | `587` | SMTP server port |
| `smtp.auth.user` | `string` | — | SMTP username |
| `smtp.auth.pass` | `string` | — | SMTP password |
| `resend.apiKey` | `string` | — | Resend API key |
| `postmark.serverToken` | `string` | — | Postmark server token |
