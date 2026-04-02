# @loewen-digital/fullstack — Design Specification

## Vision

A single npm package that provides backend primitives (auth, DB, validation, mail, storage, etc.) to any JavaScript meta-framework via thin adapters. Think "Laravel for the JS ecosystem" — but as a library, not a framework.

**One package. Direct imports. Driver pattern. Framework-agnostic core.**

-----

## Architecture

```
┌──────────────────────────────────┐
│  Meta-Framework (SvelteKit, ...) │  ← User's app
├──────────────────────────────────┤
│  Adapter (e.g. adapters/sveltekit) │  ← Thin glue layer
├──────────────────────────────────┤
│  @loewen-digital/fullstack       │  ← This package
│  ┌──────┬──────┬──────┬────────┐ │
│  │ auth │  db  │ mail │ valid. │ │
│  │ cache│queue │ i18n │  ...   │ │
│  └──────┴──────┴──────┴────────┘ │
└──────────────────────────────────┘
```

### Key Principle

The core **never** imports or depends on any framework-specific code. Every module works with **Web Standard APIs** (`Request`, `Response`, `Headers`, `URL`, `FormData`, etc.). The adapter layer is minimal because most modern meta-frameworks already use these same Web Standards.

-----

## Package Structure

```
@loewen-digital/fullstack/
├── src/
│   ├── index.ts                 → defineConfig, createStack, types
│   ├── config/
│   │   ├── index.ts             → loadConfig, defineConfig
│   │   ├── env.ts               → env() helper, type-safe env access
│   │   └── types.ts             → FullstackConfig type
│   ├── validation/
│   │   ├── index.ts             → validate(), defineRules()
│   │   ├── rules.ts             → built-in rules (required, string, max, email, ...)
│   │   ├── types.ts             → ValidationResult, Rules, etc.
│   │   └── custom.ts            → custom rule registration
│   ├── auth/
│   │   ├── index.ts             → createAuth()
│   │   ├── session.ts           → session management
│   │   ├── password.ts          → hashing, verification
│   │   ├── token.ts             → token generation, verification
│   │   ├── oauth.ts             → OAuth provider support
│   │   ├── email-verification.ts
│   │   ├── password-reset.ts
│   │   └── types.ts
│   ├── db/
│   │   ├── index.ts             → createDb()
│   │   ├── migrations.ts        → migration runner
│   │   ├── seeds.ts             → seed runner
│   │   ├── factories.ts         → test data factories
│   │   ├── pagination.ts        → paginate helper
│   │   └── types.ts
│   ├── session/
│   │   ├── index.ts             → createSession()
│   │   ├── flash.ts             → flash messages
│   │   ├── old-input.ts         → old input preservation
│   │   ├── drivers/
│   │   │   ├── cookie.ts
│   │   │   ├── memory.ts
│   │   │   └── redis.ts
│   │   └── types.ts
│   ├── security/
│   │   ├── index.ts             → createSecurity()
│   │   ├── csrf.ts              → CSRF token generation/verification
│   │   ├── cors.ts              → CORS configuration
│   │   ├── rate-limit.ts        → rate limiting
│   │   ├── sanitize.ts          → input sanitization
│   │   └── types.ts
│   ├── mail/
│   │   ├── index.ts             → createMail()
│   │   ├── template.ts          → HTML mail templates
│   │   ├── drivers/
│   │   │   ├── console.ts       → dev: log to console
│   │   │   ├── smtp.ts
│   │   │   ├── resend.ts
│   │   │   └── postmark.ts
│   │   └── types.ts
│   ├── storage/
│   │   ├── index.ts             → createStorage()
│   │   ├── drivers/
│   │   │   ├── local.ts
│   │   │   ├── s3.ts
│   │   │   ├── r2.ts
│   │   │   └── memory.ts
│   │   └── types.ts
│   ├── cache/
│   │   ├── index.ts             → createCache()
│   │   ├── drivers/
│   │   │   ├── memory.ts
│   │   │   ├── redis.ts
│   │   │   └── kv.ts            → Cloudflare KV
│   │   └── types.ts
│   ├── logging/
│   │   ├── index.ts             → createLogger()
│   │   ├── transports/
│   │   │   ├── console.ts
│   │   │   ├── file.ts
│   │   │   └── external.ts      → Sentry, LogFlare, etc.
│   │   └── types.ts
│   ├── errors/
│   │   ├── index.ts             → error classes, handler
│   │   ├── http-errors.ts       → NotFound, Unauthorized, etc.
│   │   └── types.ts
│   ├── queue/
│   │   ├── index.ts             → createQueue()
│   │   ├── job.ts               → Job class, retries, backoff
│   │   ├── drivers/
│   │   │   ├── memory.ts        → sync execution for dev
│   │   │   ├── redis.ts
│   │   │   └── cloudflare.ts    → Cloudflare Queues
│   │   └── types.ts
│   ├── events/
│   │   ├── index.ts             → createEventBus()
│   │   ├── listener.ts
│   │   └── types.ts
│   ├── notifications/
│   │   ├── index.ts             → createNotifications()
│   │   ├── channels/
│   │   │   ├── mail.ts
│   │   │   ├── push.ts
│   │   │   ├── sms.ts
│   │   │   └── in-app.ts
│   │   └── types.ts
│   ├── i18n/
│   │   ├── index.ts             → createI18n()
│   │   ├── pluralization.ts
│   │   ├── formatting.ts
│   │   └── types.ts
│   ├── search/
│   │   ├── index.ts             → createSearch()
│   │   ├── drivers/
│   │   │   ├── sqlite-fts.ts
│   │   │   ├── meilisearch.ts
│   │   │   └── typesense.ts
│   │   └── types.ts
│   ├── permissions/
│   │   ├── index.ts             → createPermissions()
│   │   ├── roles.ts             → RBAC
│   │   ├── policies.ts          → policy-based (Laravel Gates)
│   │   └── types.ts
│   ├── webhooks/
│   │   ├── index.ts             → createWebhooks()
│   │   ├── incoming.ts          → signature verification
│   │   ├── outgoing.ts          → sending + retry
│   │   └── types.ts
│   ├── realtime/
│   │   ├── index.ts             → createRealtime()
│   │   ├── websocket.ts
│   │   ├── sse.ts
│   │   └── types.ts
│   ├── testing/
│   │   ├── index.ts             → test helpers
│   │   ├── fake-mail.ts
│   │   ├── fake-storage.ts
│   │   ├── fake-queue.ts
│   │   ├── db-helpers.ts        → transactions, cleanup
│   │   └── factories.ts         → factory builder
│   ├── adapters/
│   │   ├── sveltekit/
│   │   │   ├── index.ts         → createHandle, helpers
│   │   │   └── types.ts         → App.Locals augmentation
│   │   ├── nuxt/
│   │   │   └── index.ts
│   │   ├── remix/
│   │   │   └── index.ts
│   │   └── astro/
│   │       └── index.ts
│   ├── vite/
│   │   ├── index.ts             → Vite plugin
│   │   └── dev-ui/              → Dev dashboard (DB browser, mail preview, etc.)
│   └── cli/
│       ├── index.ts             → CLI entry
│       ├── migrate.ts
│       ├── seed.ts
│       ├── generate.ts          → scaffolding
│       └── dev-ui.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

-----

## Subpath Exports (package.json)

```json
{
  "name": "@loewen-digital/fullstack",
  "exports": {
    ".": "./dist/index.js",
    "./validation": "./dist/validation/index.js",
    "./auth": "./dist/auth/index.js",
    "./db": "./dist/db/index.js",
    "./session": "./dist/session/index.js",
    "./security": "./dist/security/index.js",
    "./mail": "./dist/mail/index.js",
    "./storage": "./dist/storage/index.js",
    "./cache": "./dist/cache/index.js",
    "./logging": "./dist/logging/index.js",
    "./errors": "./dist/errors/index.js",
    "./queue": "./dist/queue/index.js",
    "./events": "./dist/events/index.js",
    "./notifications": "./dist/notifications/index.js",
    "./i18n": "./dist/i18n/index.js",
    "./search": "./dist/search/index.js",
    "./permissions": "./dist/permissions/index.js",
    "./webhooks": "./dist/webhooks/index.js",
    "./realtime": "./dist/realtime/index.js",
    "./testing": "./dist/testing/index.js",
    "./adapters/sveltekit": "./dist/adapters/sveltekit/index.js",
    "./adapters/nuxt": "./dist/adapters/nuxt/index.js",
    "./adapters/remix": "./dist/adapters/remix/index.js",
    "./adapters/astro": "./dist/adapters/astro/index.js",
    "./vite": "./dist/vite/index.js",
    "./cli": "./dist/cli/index.js"
  }
}
```

-----

## Core Design Patterns

### 1. Factory Functions (No DI, No Service Providers)

Every module exports a factory function. Config in, tools out.

```ts
// Pattern for every module with I/O
export function createMail(config: MailConfig): MailInstance {
  const driver = resolveDriver(config.driver, {
    console: () => import('./drivers/console'),
    smtp: () => import('./drivers/smtp'),
    resend: () => import('./drivers/resend'),
    postmark: () => import('./drivers/postmark'),
  })

  return {
    async send(message: MailMessage): Promise<void> { ... },
    async queue(message: MailMessage): Promise<void> { ... },
    // ...
  }
}

// Pattern for stateless modules
export function validate(
  data: Record<string, unknown>,
  rules: Rules
): ValidationResult { ... }
```

### 2. Driver Pattern

Every module with I/O has swappable backends via a driver interface.

```ts
// Each module defines its driver contract
interface StorageDriver {
  get(key: string): Promise<ReadableStream | null>
  put(key: string, data: ReadableStream | Uint8Array | string, meta?: FileMeta): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
  getUrl(key: string): Promise<string>
}

// Config selects driver by string or passes custom driver
type StorageConfig = {
  driver: 'local' | 's3' | 'r2' | 'memory' | StorageDriver
  // driver-specific options...
}
```

**Modules with drivers:**

|Module  |Built-in Drivers                      |
|--------|--------------------------------------|
|session |cookie, memory, redis                 |
|mail    |console, smtp, resend, postmark       |
|storage |local, s3, r2, memory                 |
|cache   |memory, redis, kv (Cloudflare)        |
|queue   |memory (sync), redis, cloudflare      |
|search  |sqlite-fts, meilisearch, typesense    |
|logging |console, file, external (sentry, etc.)|
|db      |sqlite, postgres, mysql, d1           |
|realtime|websocket, sse                        |

### 3. createStack Convenience

```ts
import { defineConfig, createStack } from '@loewen-digital/fullstack'

const config = defineConfig({
  db: { driver: 'sqlite', url: './data.db' },
  auth: { session: { driver: 'cookie' } },
  mail: { driver: 'console' },
  // only configure what you need
})

// Creates only the modules you configured
// TypeScript knows which properties exist based on config
export const stack = createStack(config)

// stack.db ✓ (configured)
// stack.auth ✓ (configured)
// stack.mail ✓ (configured)
// stack.queue ✗ (not configured, not on the object)
```

### 4. Adapter Interface

Since the core uses Web Standard `Request`/`Response`, adapters are thin. Most modern frameworks (SvelteKit, Nuxt, Remix, Astro) already provide standard `Request` objects, so the adapter's job is minimal — mainly wiring up the stack into the framework's middleware/hook system.

```ts
interface FullstackAdapter {
  // Wire the stack into the framework's request lifecycle
  createMiddleware(stack: StackInstance): FrameworkMiddleware

  // Framework-specific cookie access (since cookie APIs vary)
  getCookie(frameworkReq: unknown, name: string): string | undefined
  setCookie(frameworkRes: unknown, name: string, value: string, options?: CookieOptions): void
}

// The core works directly with Web Standard Request
// No custom RequestData type — use request.method, request.url,
// request.headers, request.formData(), etc.
```

-----

## Module Dependency Graph

```
config (standalone)
├── validation (standalone, stateless — no config needed)
├── errors (standalone)
├── logging (standalone)
├── i18n (standalone)
├── security (standalone)
├── events (standalone)
│
├── db (depends on: config)
│   ├── auth (depends on: db)
│   ├── permissions (depends on: db)
│   └── search (optional: db)
│
├── cache (depends on: config)
│   └── session (depends on: config, optional: cache)
│
├── mail (depends on: config)
│   └── notifications (depends on: mail, optional: push/sms)
│
├── queue (depends on: config)
│   └── events can optionally dispatch to queue
│
├── storage (depends on: config)
├── webhooks (depends on: config)
├── realtime (depends on: config)
│
└── testing (can mock any of the above)
```

-----

## Configuration

### fullstack.config.ts

```ts
import { defineConfig } from '@loewen-digital/fullstack'

export default defineConfig({
  // Database
  db: {
    driver: 'sqlite',                // 'sqlite' | 'postgres' | 'mysql' | 'd1'
    url: env('DATABASE_URL', './data.db'),
    migrations: './db/migrations',
    seeds: './db/seeds',
  },

  // Authentication
  auth: {
    providers: ['credentials'],      // 'credentials' | 'google' | 'github' | ...
    session: {
      driver: 'cookie',
      maxAge: '7d',
    },
    passwords: {
      reset: true,
      minLength: 8,
    },
    emailVerification: true,
  },

  // Mail
  mail: {
    driver: env('MAIL_DRIVER', 'console'),
    from: 'hello@example.com',
    templates: './mail-templates',
  },

  // Storage
  storage: {
    driver: env('STORAGE_DRIVER', 'local'),
    basePath: './uploads',
  },

  // Cache
  cache: {
    driver: 'memory',
    ttl: '1h',
  },

  // Queue
  queue: {
    driver: 'memory',               // sync in dev
  },

  // Security
  security: {
    csrf: true,
    cors: {
      origins: ['http://localhost:5173'],
    },
    rateLimit: {
      windowMs: '15m',
      max: 100,
    },
  },

  // Logging
  logging: {
    level: env('LOG_LEVEL', 'info'),
    transport: 'console',
  },

  // i18n
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    directory: './locales',
  },
})
```

### env() Helper

```ts
// Type-safe environment variable access
function env(key: string, fallback?: string): string
function env<T>(key: string, fallback: T): T

// Usage
env('DATABASE_URL')              // throws if missing
env('DATABASE_URL', './data.db') // fallback
```

-----

## SvelteKit Adapter Example

### hooks.server.ts

```ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { stack } from '$lib/server/fullstack'

export const handle = createHandle(stack)
```

### $lib/server/fullstack.ts

```ts
import { loadConfig, createStack } from '@loewen-digital/fullstack'

const config = loadConfig()
export const stack = createStack(config)
export const { db, auth, validate, mail } = stack
```

### +page.server.ts

```ts
import { db, auth, validate } from '$lib/server/fullstack'
import { fail, redirect } from '@sveltejs/kit'

export async function load({ locals }) {
  const posts = await db.posts.findMany({ limit: 20 })
  return { posts, user: locals.fullstack.session?.user }
}

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.fullstack.session) throw redirect(303, '/login')

    const formData = await request.formData()
    const result = validate(Object.fromEntries(formData), {
      title: 'required|string|max:255',
      body: 'required|string',
    })

    if (!result.ok) return fail(422, { errors: result.errors })

    await db.posts.create({
      ...result.data,
      authorId: locals.fullstack.session.user.id,
    })

    throw redirect(303, '/posts')
  }
}
```

-----

## Validation API

Validation is stateless — no factory function needed.

```ts
import { validate, defineRules } from '@loewen-digital/fullstack/validation'

// Laravel-style string rules
const result = validate(data, {
  title: 'required|string|max:255',
  email: 'required|email',
  age: 'required|number|min:18',
  role: 'required|in:admin,user,editor',
  password: 'required|string|min:8|confirmed',
})

// Object-style rules (more flexible)
const result = validate(data, {
  title: { required: true, type: 'string', max: 255 },
  tags: { type: 'array', each: { type: 'string', max: 50 } },
})

// TypeScript: result is typed
if (result.ok) {
  result.data // { title: string, email: string, ... }
} else {
  result.errors // { title: string[], email: string[] }
}

// Custom rules
defineRules({
  slug: (value) => /^[a-z0-9-]+$/.test(value) || 'Must be a valid slug',
  unique: async (value, table, column) => { /* check DB */ },
})
```

### Built-in Rules

- `required` — must be present and non-empty
- `string` / `number` / `boolean` / `array` / `object` — type checks
- `min:N` / `max:N` — length (strings/arrays) or value (numbers)
- `email` — valid email format
- `url` — valid URL format
- `in:a,b,c` — must be one of listed values
- `confirmed` — field must match `{field}_confirmation`
- `regex:pattern` — must match regex
- `date` / `before:date` / `after:date` — date validation
- `uuid` — valid UUID
- `nullable` — allows null
- `optional` — allows undefined (skips other rules)
- `unique:table,column` — async DB uniqueness check (requires db instance)

-----

## Dev Tooling

### Vite Plugin

```ts
// vite.config.ts
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'

export default defineConfig({
  plugins: [
    sveltekit(),
    fullstackPlugin()  // reads fullstack.config.ts
  ]
})
```

**What the plugin provides:**

- Dev UI dashboard at `/__fullstack/`
- Auto-restart on config changes
- Type generation for DB schemas

### Dev UI Dashboard (/__fullstack/)

- `/db` — DB browser, query runner, migration status
- `/mail` — Sent mail preview (captured in console driver)
- `/queue` — Job status, failed jobs, retry
- `/cache` — Cache inspector, flush
- `/logs` — Structured log viewer
- `/storage` — File browser
- `/events` — Event timeline
- `/config` — Active configuration overview

### CLI

```bash
npx fullstack migrate          # Run pending migrations
npx fullstack migrate:rollback # Rollback last batch
npx fullstack seed             # Run seeders
npx fullstack generate migration create_posts_table
npx fullstack generate factory PostFactory
npx fullstack generate seed PostSeeder
```

-----

## Testing

```ts
import { createTestStack } from '@loewen-digital/fullstack/testing'

// Creates stack with all drivers set to memory/fake
const stack = createTestStack({
  db: { driver: 'sqlite', url: ':memory:' },
})

// Fake mail — captures sent messages
stack.mail.send({ to: 'user@test.com', subject: 'Hello' })
stack.mail.sent // [{ to: 'user@test.com', subject: 'Hello', ... }]

// Fake storage — in-memory
await stack.storage.put('file.txt', new TextEncoder().encode('hello'))
await stack.storage.get('file.txt') // ReadableStream

// DB factories
const user = await stack.db.factory('user').create()
const posts = await stack.db.factory('post').count(5).create({ authorId: user.id })

// DB transaction rollback per test
await stack.db.beginTransaction()
// ... test code ...
await stack.db.rollback()
```

-----

## Technology Choices

|Concern      |Choice             |Rationale                                   |
|-------------|-------------------|--------------------------------------------|
|Language     |TypeScript         |Type safety, DX                             |
|ORM          |Drizzle            |Lightweight, SQL-close, good TS support     |
|Build        |Vite (library mode)|ESM only, no CJS — consistent with ecosystem|
|Test         |Vitest             |Fast, Vite-native, good DX                  |
|Password hash|argon2 / bcrypt    |Industry standard                           |
|Crypto       |Web Crypto API     |`crypto.subtle` — works in all runtimes     |
|Mail template|MJML or custom HTML|Responsive email                            |
|Dev UI       |SvelteKit          |Primary framework, great DX                 |
|CLI          |citty or custom    |Lightweight                                 |
