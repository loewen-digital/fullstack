# @loewen-digital/fullstack

Backend primitives for JavaScript meta-frameworks: auth, sessions, validation, mail, storage, cache, queue, events, logging, errors, permissions, notifications, i18n, search, webhooks, realtime, and a Drizzle `db` module for apps on a SQL database. One package with one subpath per module, factory functions instead of a container, swappable drivers, Web Standard `Request` and `Response` everywhere, a framework-agnostic core and adapters for SvelteKit, Nuxt, Remix and Astro.

Documentation: [fullstack-docs-vitepress.pages.dev](https://fullstack-docs-vitepress.pages.dev)

## Install

```bash
npm install @loewen-digital/fullstack
```

Node 24, ESM only, TypeScript 5. The modules talk HTTP through `fetch` or take a client you hand them, so you install only what your drivers need: `@loewen-digital/flatdb` and `zod` for auth on flatdb, `nodemailer` for SMTP, `drizzle-orm` and `better-sqlite3` for the `db` module (`better-sqlite3` also for the sqlite search driver), a Redis client for the redis drivers. The package itself has no dependencies. Details on the [installation page](https://fullstack-docs-vitepress.pages.dev/getting-started/installation).

## What it looks like

Every module is a factory that takes a typed config and returns an instance; nothing is global. `auth` stores nothing itself: it takes an `AuthDbAdapter`, and `@loewen-digital/fullstack/auth/flatdb` ships one for [flatdb](https://github.com/loewen-digital/flatdb) collections.

```ts
// src/lib/server/stack.ts
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'
import { createSession } from '@loewen-digital/fullstack/session'
import { createMail } from '@loewen-digital/fullstack/mail'

export declare const authDb: AuthDbAdapter // createFlatdbAuthAdapter({ users, sessions, tokens }), or your own

export const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
export const session = createSession({ driver: 'cookie', secret: process.env.SESSION_SECRET! })
export const mail = createMail({ driver: 'console', from: 'My App <hello@example.com>' })
```

The adapter wires them into the framework. On every request it opens the session cookie, validates the auth cookie and checks the CSRF header on mutating requests; the result lands on `event.locals`.

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth, session } from '$lib/server/stack'

export const handle = createHandle({ auth, session })
```

Validation is one async function with pipe-string rules:

```ts
import { validate } from '@loewen-digital/fullstack/validation'

declare const input: Record<string, unknown>

const result = await validate(input, { email: 'required|email', password: 'required|string|min:8' })
if (!result.ok) console.log(result.errors) // [{ field: 'password', rule: 'min', message: '...' }]
```

The [quick start](https://fullstack-docs-vitepress.pages.dev/getting-started/quick-start) builds register, login, a guarded page and logout from these pieces. The code blocks in this file and in the docs are type-checked against the package by the test suite.

## Modules

All subpaths sit below `@loewen-digital/fullstack`. Each module's page lists its API, the options its factory reads and their defaults.

| Module | Subpath | What you get |
|---|---|---|
| Config | `/config` | `defineConfig`, `loadConfig`, `env()` with typed fallbacks; `createStack(config, { authDb })` from the root builds every configured module |
| Validation | `/validation` | `validate(data, rules)` with pipe-string or object rules, `defineRules` for your own; no I/O |
| Auth | `/auth`, `/auth/flatdb` | `createAuth(config, { db })`: password hashing, sessions, email verification, password reset, one-time tokens, OAuth; `createFlatdbAuthAdapter` for flatdb collections |
| DB | `/db` | `createDb(config, schema)`: Drizzle on SQLite with migrations, seeds, factories and pagination, for apps on a SQL database, Node-only; needs `drizzle-orm` and `better-sqlite3`. Apps on flatdb call flatdb directly |
| Session | `/session` | `createSession`: flash messages and old input on `memory`, `cookie` (signed, stateless) or `redis` |
| Security | `/security` | `createSecurity`: CSRF tokens, CORS headers, a rate limiter, `sanitize` |
| Mail | `/mail` | `createMail`: `console`, SMTP via `nodemailer`, Resend, Postmark; `{{ }}` templates |
| Storage | `/storage` | `createStorage`: `memory`, `local`, S3, R2 |
| Cache | `/cache` | `createCache`: `memory`, Redis, Cloudflare KV; `remember(key, ttl, fn)` |
| Queue | `/queue` | `createQueue`: `memory`, Redis, Cloudflare Queues; retries and a dead-letter list |
| Events | `/events` | `createEventBus`, `defineEvents`: a typed in-process bus |
| Logging | `/logging` | `createLogger`: console, file and external transports, child loggers |
| Errors | `/errors` | `FullstackError` and the HTTP errors, `errorToResponse`, `isFullstackError` |
| Permissions | `/permissions` | `createPermissions`: roles with wildcards and inheritance, policies, `can` and `authorize` |
| Notifications | `/notifications` | `createNotifications`: one `notify` call fans out to mail, in-app, SMS and push |
| i18n | `/i18n` | `createI18n`: `t`, `tn` for plurals, `number`, `date`, `loadTranslations` |
| Search | `/search` | `createSearch`: SQLite FTS5 via `better-sqlite3`, Meilisearch, Typesense |
| Webhooks | `/webhooks` | `createWebhooks`: verify signed incoming webhooks, send outgoing ones with retries and a delivery log |
| Realtime | `/realtime` | `createRealtime`: channels with `broadcast`, `sse()` as a streaming `Response` |
| Testing | `/testing` | `createTestStack`, fake mail, queue and storage drivers, `defineFactory`, `withSavepoint` |

A driver named in the config (`memory`, `console`, `cookie`, `sqlite`) needs nothing else. A driver that needs credentials or a client is built with its own factory and handed to the module's `createXInstance`, for example `createMailInstance(createResendDriver({ apiKey }), { driver: 'resend', from })`. The [driver pattern](https://fullstack-docs-vitepress.pages.dev/core-concepts/driver-pattern) page lists every driver and which kind it is.

## Adapters

The core imports nothing from a framework; the adapters do the wiring. Each opens the session cookie, validates the auth cookie, checks the CSRF header on mutating requests and offers helpers for login, logout and form validation.

| Framework | Subpath | Entry point |
|---|---|---|
| SvelteKit | `/adapters/sveltekit` | `createHandle(stack)` fills `event.locals`; `validateForm`, `setAuthCookie`, `clearAuthCookie`, `getCsrfToken` |
| Nuxt | `/adapters/nuxt` | `createNuxtMiddleware(stack)` fills `event.context` |
| Remix | `/adapters/remix` | `createRemixLoader(stack)` and `createRemixAction(stack)` wrap loaders and actions |
| Astro | `/adapters/astro` | `createAstroMiddleware(stack)` fills `Astro.locals` |

## Testing

`createTestStack()` returns mail, storage and queue on fake drivers that record what happened, and cache and session on memory drivers. Pass `db: { driver: 'sqlite', url: ':memory:' }` to add a Drizzle `db` for a SQL app.

```ts
import { createTestStack } from '@loewen-digital/fullstack/testing'

const stack = createTestStack()
await stack.mail.send({ to: 'alice@example.com', subject: 'Welcome', text: 'Hi' })
stack.fakeMail.sentTo('alice@example.com') // one message
stack.reset()
```

`defineFactory`, `sequence` and `pick` build test records; `withSavepoint`, `createDbCleaner` and `seedOnce` keep SQLite tests isolated. See the [testing pages](https://fullstack-docs-vitepress.pages.dev/testing/overview).

## CLI

The package installs a `fullstack` binary that reads `fullstack.config.ts` from the current directory and needs its `db` section.

```bash
npx fullstack migrate                      # pending Drizzle migrations from db.migrations
npx fullstack migrate:rollback
npx fullstack migrate:status
npx fullstack seed [file]                  # database/seeds/index.ts by default
npx fullstack generate migration <name>    # also: generate factory <name>, generate seed <name>
```

## Vite plugin and Dev UI

`fullstackPlugin` loads `fullstack.config.ts`, exposes it as `virtual:fullstack/config` and writes `fullstack.d.ts` for it. During `vite dev` it serves the Dev UI at `/__fullstack/`: mail sent through the console driver, jobs on the memory queue, log lines, cache entries and the config.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'

export default defineConfig({ plugins: [fullstackPlugin()] })
```

## Requirements

- Node 24 (`engines.node`), or Bun, Deno and Cloudflare Workers with `nodejs_compat` for the modules that need no Node API (db, local storage, the file log transport and SMTP do)
- ESM only; there is no CommonJS build
- TypeScript 5 with `moduleResolution` set to `bundler`, `node16` or `nodenext`

## Contributing

The rules for changes live in [AGENTS.md](AGENTS.md); every change a user would notice gets a line in [CHANGELOG.md](CHANGELOG.md). `npm run lint && npm run typecheck && npm test && npm run build` must pass.

## License

MIT
