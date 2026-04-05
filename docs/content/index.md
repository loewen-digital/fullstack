---
title: '@loewen-digital/fullstack'
description: Laravel for JS — backend primitives for any meta-framework
---

# @loewen-digital/fullstack

A single npm package providing backend primitives for any JavaScript meta-framework. Think "Laravel for the JS ecosystem" — but as a composable library, not a framework.

**One package. Direct imports. Driver pattern. Framework-agnostic core.**

## What is it?

`@loewen-digital/fullstack` gives you everything you need to build production-quality backend logic in your JS meta-framework of choice:

- **Authentication** — sessions, passwords, tokens, OAuth
- **Database** — Drizzle ORM wrapper with migrations, seeds, pagination, and factories
- **Validation** — stateless, schema-driven input validation
- **Mail** — pluggable drivers (SMTP, Resend, Postmark, console)
- **Storage** — file storage with local, S3, R2, and memory drivers
- **Cache** — key-value caching with memory, Redis, and KV drivers
- **Sessions** — cookie, memory, and Redis session drivers
- **Security** — CSRF protection, CORS, rate limiting, input sanitization
- **Queue** — background jobs with pluggable drivers
- **Events** — lightweight in-process event bus
- **Logging** — structured logging with pluggable transports
- **i18n** — internationalization with pluralization and number/date formatting
- **Permissions** — roles, policies, and authorization helpers
- **Notifications** — multi-channel notifications (mail, SMS, push)
- **Search** — full-text search with SQLite FTS, Meilisearch, and Typesense drivers
- **Realtime** — WebSocket and SSE helpers
- **Webhooks** — incoming and outgoing webhook handling
- **Testing** — fakes, factories, and a `createTestStack()` helper

## Philosophy

Every module follows these principles:

- **Factory functions** — `createAuth(config)`, not `new Auth()` or service providers
- **Driver pattern** — swap backends without changing application code
- **Web Standards first** — `Request`, `Response`, `Headers`, `URL`, `FormData` — no custom abstractions
- **TypeScript-first** — everything is fully typed with inferred return types
- **Tree-shakeable** — import only what you use

## Quick example

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'
import { createDb } from '@loewen-digital/fullstack/db'
import { validate } from '@loewen-digital/fullstack/validation'

const db = createDb({ driver: 'sqlite', url: './app.db' })
const auth = createAuth({ db, session: { driver: 'cookie' } })

// Validate incoming data
const result = validate(formData, {
  email: ['required', 'email'],
  password: ['required', 'min:8'],
})

// Authenticate a user
const user = await auth.attempt({ email, password })
```

## Framework adapters

The core is completely framework-agnostic. Thin adapters wire it into your meta-framework of choice:

- **SvelteKit** — `createHandle()` for `hooks.server.ts`
- **Nuxt** — server middleware integration
- **Remix** — loader/action helpers
- **Astro** — middleware integration

## Get started

Head to the [Installation guide](/getting-started/installation) to add `@loewen-digital/fullstack` to your project.

