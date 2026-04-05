---
title: Configuration
description: How to configure @loewen-digital/fullstack modules and manage environment variables
---

# Configuration

Each module is configured independently when you call its factory function. There is no global config file — configuration lives where the module is instantiated.

## Per-module configuration

Every factory function accepts a typed config object:

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({
  driver: 'smtp',
  from: { name: 'My App', address: 'hello@example.com' },
  smtp: {
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  },
})
```

TypeScript will tell you exactly what properties each config object accepts.

## Using `defineConfig` and `createStack`

For larger applications, use `defineConfig` to declare your full stack configuration in one place, then `createStack` to instantiate everything at once:

```ts
// src/lib/stack.ts
import { defineConfig, createStack } from '@loewen-digital/fullstack'

const config = defineConfig({
  db: {
    driver: 'sqlite',
    url: './app.db',
  },
  auth: {
    session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
  },
  mail: {
    driver: process.env.NODE_ENV === 'production' ? 'resend' : 'console',
    from: { name: 'My App', address: 'hello@example.com' },
    resend: { apiKey: process.env.RESEND_API_KEY! },
  },
  cache: {
    driver: 'memory',
  },
})

export const stack = createStack(config)
// stack.db, stack.auth, stack.mail, stack.cache — all fully typed
```

## Environment variables

Use the `env()` helper for safe, typed environment variable access:

```ts
import { env } from '@loewen-digital/fullstack/config'

const dbUrl = env('DATABASE_URL')                    // string | undefined
const secret = env('SESSION_SECRET', { required: true }) // string (throws if missing)
const port   = env('PORT', { default: '3000' })      // string
```

## Switching drivers per environment

A common pattern is to use lightweight in-memory or console drivers in development and real external services in production:

```ts
const mail = createMail({
  driver: process.env.NODE_ENV === 'production' ? 'resend' : 'console',
  // ...
})

const cache = createCache({
  driver: process.env.REDIS_URL ? 'redis' : 'memory',
  redis: { url: process.env.REDIS_URL },
})
```

## Config type reference

Every module exports its config type. You can import them for use in your own wrapper functions:

```ts
import type { MailConfig } from '@loewen-digital/fullstack/mail'
import type { AuthConfig } from '@loewen-digital/fullstack/auth'
import type { DbConfig }   from '@loewen-digital/fullstack/db'
```
