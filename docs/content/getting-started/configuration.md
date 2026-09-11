---
title: Configuration
description: How modules are configured, where drivers with credentials come from, and how env() and createStack fit in
---

# Configuration

Each module is configured when its factory is called. There is no global config file the modules read; `defineConfig` and `createStack` exist for apps that want one object for everything, and the [Vite plugin](/tooling/vite-plugin) reads a `fullstack.config.ts` written with `defineConfig`.

## Per-module configuration

Every factory takes a typed config object. TypeScript tells you what a module accepts; the module pages list the options with their defaults.

```ts
import { createCache } from '@loewen-digital/fullstack/cache'
import { createLogger } from '@loewen-digital/fullstack/logging'

const cache = createCache({ driver: 'memory', ttl: '10m' })
const logger = createLogger({ level: 'info', format: 'prod' })
```

## Drivers with credentials

A driver name in the config picks a driver that needs nothing else: `console` for mail, `memory` for cache, storage, session and queue, `cookie` for session, `sqlite` for db, `sqlite-fts` for search. A driver that needs credentials or a client is built with its own factory and handed to the module's `createXInstance`; the config it needs is typed on that factory, not on the module config.

```ts
import { createMailInstance, createResendDriver } from '@loewen-digital/fullstack/mail'
import { createStorageInstance, createR2Driver } from '@loewen-digital/fullstack/storage'

const mail = createMailInstance(createResendDriver({ apiKey: process.env.RESEND_API_KEY! }), {
  driver: 'resend',
  from: 'My App <hello@example.com>',
})

const storage = createStorageInstance(
  createR2Driver({
    accountId: process.env.R2_ACCOUNT_ID!,
    bucket: 'uploads',
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  }),
)
```

`createMail({ driver: 'resend' })` without the driver factory throws and names the factory to use. The [driver pattern](/core-concepts/driver-pattern) page lists every driver and which kind it is.

## Switching drivers per environment

Lightweight drivers in development, real services in production: decide by the environment variable that the real service needs.

```ts
import { createMail, createMailInstance, createResendDriver } from '@loewen-digital/fullstack/mail'

const from = 'My App <hello@example.com>'

export const mailer = process.env.RESEND_API_KEY
  ? createMailInstance(createResendDriver({ apiKey: process.env.RESEND_API_KEY }), { driver: 'resend', from })
  : createMail({ driver: 'console', from })
```

The console driver prints every message and keeps it in `mail.sent`, so the same code runs in tests.

## `env()`

`env(key)` reads `process.env[key]` and throws when it is missing. With a fallback the return type follows the fallback: a string, a number (parsed, throws when not numeric) or a boolean (`true`/`1`/`false`/`0`).

```ts
import { env } from '@loewen-digital/fullstack/config'

const databaseUrl = env('DATABASE_URL') // string, throws when unset
const port = env('PORT', 3000) // number
const debug = env('DEBUG', false) // boolean
const appName = env('APP_NAME', 'fullstack') // string
```

On Cloudflare Workers `process.env` is empty; read secrets from the platform's `env` (in SvelteKit `$env/dynamic/private`) instead.

## `defineConfig` and `createStack`

`createStack(config, deps)` builds every module the config names and returns only those: the return type is inferred from the keys you pass. `defineConfig` returns its argument unchanged and only types it.

```ts
import { defineConfig, createStack } from '@loewen-digital/fullstack'
import type { AuthDbAdapter } from '@loewen-digital/fullstack/auth'

declare const authDb: AuthDbAdapter // see the Auth on flatdb guide

const config = defineConfig({
  db: { driver: 'sqlite', url: './app.db', migrations: './drizzle' },
  auth: { sessionTtl: 7 * 24 * 3600 },
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
  mail: { driver: 'console', from: 'My App <hello@example.com>' },
  cache: { driver: 'memory' },
  logging: { level: 'info' },
})

export const stack = createStack(config, { authDb })
// stack.db, stack.auth, stack.session, stack.mail, stack.cache, stack.logging; nothing else
```

`auth` needs its adapter through `deps.authDb`; without it `createStack` throws a `ConfigError`. The stack builds modules from driver names only, so drivers with credentials (Resend, Redis, S3) are created next to the stack with their factories, as above.

A `fullstack.config.ts` with `export default defineConfig({ ... })` is what the Vite plugin and the [CLI](/tooling/cli) load: `db.migrations` and `db.seeds` are the paths the migrate and seed commands use.

## Config keys

`FullstackConfig` has one optional key per module. Each module page lists what its factory reads.

| Key | Module | Read by |
|---|---|---|
| `db` | [db](/modules/db) | `createDb`: `driver`, `url`, `migrations`, `seeds` |
| `auth` | [auth](/modules/auth) | `createAuth`: the three TTLs |
| `session` | [session](/modules/session) | `createSession`: `driver`, `secret`, `maxAge` |
| `mail` | [mail](/modules/mail) | `createMail`: `driver`, `from`, `silent` |
| `storage` | [storage](/modules/storage) | `createStorage`: `driver` |
| `cache` | [cache](/modules/cache) | `createCache`: `driver`, `ttl` |
| `queue` | [queue](/modules/queue) | `createQueue`: `driver` |
| `security` | [security](/modules/security) | `createSecurity`: `csrf`, `cors`, `rateLimit` |
| `logging` | [logging](/modules/logging) | `createLogger`: `level`, `format` |
| `i18n` | [i18n](/modules/i18n) | `createI18n`: `defaultLocale`, `locales`, `directory` |
| `notifications`, `permissions`, `search`, `webhooks`, `realtime` | the module of that name | its factory |

## Config types

Every module exports its config type for your own wrappers; `FullstackConfig` comes from `@loewen-digital/fullstack/config`.

```ts
import type { FullstackConfig } from '@loewen-digital/fullstack/config'
import type { MailConfig } from '@loewen-digital/fullstack/mail'
import type { AuthConfig } from '@loewen-digital/fullstack/auth'
import type { DbConfig } from '@loewen-digital/fullstack/db'
```
