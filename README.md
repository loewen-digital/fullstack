# @loewen-digital/fullstack

Backend primitives for any JavaScript meta-framework — auth, DB, validation, mail, storage, queue, and more.

Think "Laravel for the JS ecosystem" — but as a composable library, not a framework. One package. Direct imports. Swappable drivers. Framework-agnostic core.

## Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Modules](#modules)
  - [Config](#config)
  - [Validation](#validation)
  - [Auth](#auth)
  - [Database](#database)
  - [Session](#session)
  - [Security](#security)
  - [Mail](#mail)
  - [Storage](#storage)
  - [Cache](#cache)
  - [Queue](#queue)
  - [Events](#events)
  - [Logging](#logging)
  - [Errors](#errors)
  - [Permissions](#permissions)
  - [Notifications](#notifications)
  - [i18n](#i18n)
  - [Search](#search)
  - [Webhooks](#webhooks)
  - [Realtime](#realtime)
- [Framework Adapters](#framework-adapters)
  - [SvelteKit](#sveltekit)
  - [Nuxt](#nuxt)
  - [Remix](#remix)
  - [Astro](#astro)
- [Testing](#testing)
- [CLI](#cli)
- [Vite Plugin](#vite-plugin)
- [Requirements](#requirements)

---

## Installation

```bash
npm install @loewen-digital/fullstack
```

External drivers (SMTP, Redis, S3, etc.) require their respective packages — install only what you use.

---

## Quick Start

Define your config once, create the stack, and use it anywhere:

```ts
// src/lib/server/stack.ts
import { defineConfig, createStack } from '@loewen-digital/fullstack'

const config = defineConfig({
  db:      { driver: 'sqlite', url: './data.db' },
  auth:    { sessionTtl: '7d', tokenTtl: '1h' },
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET },
  mail:    { driver: 'console' },
  cache:   { driver: 'memory', ttl: '5m' },
  queue:   { driver: 'memory' },
  storage: { driver: 'local', root: './uploads' },
})

export const stack = createStack(config)
```

`createStack` returns only the modules you configure — everything is tree-shakeable.

---

## Modules

### Config

```ts
import { defineConfig, loadConfig, env } from '@loewen-digital/fullstack/config'

// Type-safe env access
const port = env('PORT', 'number', 3000)
const secret = env('APP_SECRET', 'string') // throws if missing

// Load from fullstack.config.ts
const config = await loadConfig()
```

---

### Validation

Stateless rule-based validation with type inference.

```ts
import { validate } from '@loewen-digital/fullstack/validation'

const result = validate(formData, {
  name:     'required|string|max:100',
  email:    'required|email',
  age:      'required|number|min:18',
  website:  'optional|url',
  password: 'required|string|min:8',
  password_confirmation: 'required|confirmed:password',
})

if (!result.success) {
  console.log(result.errors) // { email: ['Must be a valid email address'] }
}

// result.data is typed from the rules
```

Built-in rules: `required`, `optional`, `nullable`, `string`, `number`, `boolean`, `array`, `object`, `min`, `max`, `email`, `url`, `uuid`, `date`, `before`, `after`, `in`, `regex`, `confirmed`.

Custom rules:

```ts
import { defineRules } from '@loewen-digital/fullstack/validation'

defineRules({
  async unique(value, [table, column]) {
    const exists = await db.query(`SELECT 1 FROM ${table} WHERE ${column} = ?`, [value])
    return exists ? 'This value is already taken.' : true
  },
})
```

---

### Auth

Password hashing, session auth, token auth, email verification, password reset, and OAuth.

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'

const auth = createAuth({
  db: myDbAdapter,     // AuthDbAdapter — schema-agnostic
  sessionTtl: '7d',
  tokenTtl: '1h',
})

// Register
const hash = await auth.hashPassword('secret123')

// Login
const token = await auth.createSession(userId)

// Validate on each request
const session = await auth.validateSession(token)
if (!session) throw new UnauthorizedError()

// Password reset flow
await auth.sendPasswordResetEmail(user, resetUrl)
await auth.resetPassword(resetToken, newPassword)

// Email verification
await auth.sendVerificationEmail(user, verifyUrl)
await auth.verifyEmail(verifyToken)

// OAuth
const provider = auth.createOAuthProvider({
  clientId: '...',
  clientSecret: '...',
  authorizeUrl: 'https://provider.com/oauth/authorize',
  tokenUrl: 'https://provider.com/oauth/token',
  userInfoUrl: 'https://provider.com/api/user',
  scopes: ['email', 'profile'],
})
const authUrl = provider.getAuthorizationUrl(redirectUri, state)
const user = await provider.handleCallback(code, redirectUri)
```

---

### Database

Drizzle ORM wrapper with migrations, seeds, factories, and pagination.

```ts
import { createDb } from '@loewen-digital/fullstack/db'
import * as schema from './schema.js'

const db = createDb({ driver: 'sqlite', url: './data.db', schema })

// Use Drizzle directly
const users = await db.drizzle.select().from(schema.users)

// Paginate
const page = await db.paginate(
  db.drizzle.select().from(schema.users),
  { page: 1, perPage: 20 }
)
// { data, total, page, perPage, lastPage }

// Migrations
await db.migrate()
await db.rollback()
const status = await db.migrationStatus()

// Seeds
await db.seed()

// Close connection
await db.close()
```

---

### Session

Server-side sessions with flash messages and old input preservation.

```ts
import { createSession } from '@loewen-digital/fullstack/session'

const sessions = createSession({ driver: 'cookie', secret: env('SESSION_SECRET') })

// Load or create
const handle = await sessions.load(existingSessionId)

handle.set('userId', 42)
handle.get<number>('userId') // 42

// Flash messages (available on the NEXT request only)
handle.flash('success', 'Profile updated!')
handle.getFlash('success')

// Old input (for repopulating forms after validation errors)
handle.flashInput({ email: 'user@example.com' })
handle.getOldInput('email')

await handle.save()
await handle.regenerate() // new session ID (post-login)
await handle.destroy()
```

**Drivers:** `memory` (dev), `cookie` (signed, stateless), `redis` (production)

---

### Security

CSRF protection, CORS headers, rate limiting, and input sanitization.

```ts
import { createSecurity } from '@loewen-digital/fullstack/security'

const security = createSecurity({ secret: env('APP_SECRET') })

// CSRF
const token = await security.generateCsrfToken()
const valid = await security.verifyCsrfToken(submittedToken)

// CORS
const headers = security.corsHeaders({
  origin: 'https://myapp.com',
  methods: ['GET', 'POST'],
  credentials: true,
})

// Rate limiting
const limiter = security.createRateLimiter({ window: '1m', max: 60 })
const result = await limiter.check(clientIp)
if (!result.allowed) throw new RateLimitError()

// Sanitization
const clean = security.sanitize(userInput)
const escaped = security.escapeHtml('<script>alert("xss")</script>')
```

---

### Mail

Send email via multiple drivers with template rendering.

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const mail = createMail({
  driver: 'smtp',
  from: 'noreply@myapp.com',
  host: env('SMTP_HOST'),
  port: 587,
  user: env('SMTP_USER'),
  pass: env('SMTP_PASS'),
})

await mail.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: mail.render('./templates/welcome.html', { name: 'Alice' }),
  text: 'Welcome, Alice!',
})
```

**Drivers:** `console` (dev + capture), `smtp` (nodemailer), `resend`, `postmark`

Template variables use `{{ variable }}` (HTML-escaped) or `{{{ variable }}}` (raw HTML).

---

### Storage

File storage with a consistent interface across backends.

```ts
import { createStorage } from '@loewen-digital/fullstack/storage'

const storage = createStorage({
  driver: 's3',
  bucket: env('S3_BUCKET'),
  region: env('AWS_REGION'),
  accessKeyId: env('AWS_ACCESS_KEY_ID'),
  secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
})

await storage.put('avatars/user-1.png', fileBytes)
const data = await storage.get('avatars/user-1.png') // Uint8Array | null
const url  = await storage.getUrl('avatars/user-1.png')

await storage.exists('avatars/user-1.png') // true
await storage.list('avatars/')             // ['avatars/user-1.png', ...]
await storage.delete('avatars/user-1.png')
```

**Drivers:** `memory` (dev/test), `local` (filesystem), `s3` (AWS S3), `r2` (Cloudflare R2)

---

### Cache

Key-value caching with TTL support.

```ts
import { createCache } from '@loewen-digital/fullstack/cache'

const cache = createCache({ driver: 'memory', ttl: '5m' })

await cache.set('user:1', userData, '10m')
const user = await cache.get<User>('user:1')

// Lazy computation — fetch and cache in one call
const posts = await cache.remember('posts:featured', '1h', async () => {
  return await db.fetchFeaturedPosts()
})

await cache.has('user:1')    // true
await cache.delete('user:1')
await cache.flush()
```

**Drivers:** `memory`, `redis` (pass your client), `kv` (Cloudflare KV)

---

### Queue

Background job processing.

```ts
import { createQueue, Job } from '@loewen-digital/fullstack/queue'

const queue = createQueue({ driver: 'memory' })

// Define handlers
queue.register('send-welcome-email', async (job) => {
  await mail.send({ to: job.data.email, subject: 'Welcome!', text: '...' })
})

// Dispatch jobs
await queue.dispatch('send-welcome-email', { email: 'user@example.com' })

// Process (typically in a worker process)
await queue.process()
```

**Drivers:** `memory` (sync, dev), `redis`, `cloudflare` (Cloudflare Queues)

---

### Events

In-process typed event bus.

```ts
import { createEventBus, defineEvents } from '@loewen-digital/fullstack/events'

const Events = defineEvents<{
  'user.registered': { userId: number; email: string }
  'order.placed':    { orderId: string; total: number }
}>()

const bus = createEventBus<typeof Events>()

const off = bus.on('user.registered', async ({ userId, email }) => {
  await queue.dispatch('send-welcome-email', { email })
})

await bus.emit('user.registered', { userId: 1, email: 'alice@example.com' })

off() // unsubscribe
```

---

### Logging

Structured logging with multiple transports.

```ts
import { createLogger, consoleTransport, fileTransport } from '@loewen-digital/fullstack/logging'

const logger = createLogger({
  level: 'info',
  transports: [
    consoleTransport(),
    fileTransport({ path: './logs/app.log' }),
  ],
})

logger.info('Server started', { port: 3000 })
logger.error('Payment failed', { userId: 1, error: err.message })

// Child logger with shared context
const reqLogger = logger.child({ requestId: 'abc-123' })
reqLogger.info('Handling request')
```

**Levels:** `debug` < `info` < `warn` < `error` < `fatal`

---

### Errors

HTTP error classes and response helpers.

```ts
import {
  NotFoundError, UnauthorizedError, ForbiddenError,
  ValidationError, RateLimitError,
  errorToResponse, isFullstackError,
} from '@loewen-digital/fullstack/errors'

throw new NotFoundError('User not found')
throw new UnauthorizedError()
throw new ForbiddenError('Insufficient permissions')
throw new ValidationError('Invalid input', { errors: result.errors })

// In your error handler
if (isFullstackError(err)) {
  return errorToResponse(err) // Returns a proper Response with JSON body
}
```

---

### Permissions

Role-based access control and policy authorization.

```ts
import { createPermissions } from '@loewen-digital/fullstack/permissions'

const permissions = createPermissions()

// Define roles
permissions.defineRole('admin', ['*'])
permissions.defineRole('editor', ['posts.*', 'comments.read'])
permissions.defineRole('viewer', ['posts.read', 'comments.read'])

// Assign roles to users
permissions.assignRole(userId, 'editor')

// Check permissions
await permissions.can(userId, 'posts.create')  // true
await permissions.can(userId, 'users.delete')  // false

// Policies (more granular control)
permissions.definePolicy('posts.update', async (userId, post) => {
  return post.authorId === userId
})

await permissions.authorize(userId, 'posts.update', post) // throws ForbiddenError
```

---

### Notifications

Send notifications across multiple channels from a single call.

```ts
import { createNotifications } from '@loewen-digital/fullstack/notifications'

const notifications = createNotifications({ mail })

class WelcomeNotification {
  channels() { return ['mail', 'in-app'] as const }

  toMail() {
    return { subject: 'Welcome!', text: 'Thanks for signing up.' }
  }

  toInApp() {
    return { title: 'Welcome!', body: 'Thanks for signing up.' }
  }
}

await notifications.notify(user, new WelcomeNotification())

// In-app notifications
const inApp = await notifications.getInApp(userId)
await notifications.markAsRead(notificationId)
const count = await notifications.unreadCount(userId)
```

---

### i18n

Internationalization with pluralization and number/date formatting.

```ts
import { createI18n, loadTranslations } from '@loewen-digital/fullstack/i18n'

const i18n = createI18n({
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      greeting: 'Hello, {{ name }}!',
      items: { one: '{{ count }} item', other: '{{ count }} items' },
    },
  },
})

i18n.t('greeting', { name: 'Alice' })    // 'Hello, Alice!'
i18n.tn('items', 1)                      // '1 item'
i18n.tn('items', 5)                      // '5 items'
i18n.number(1234567.89)                  // '1,234,567.89'
i18n.date(new Date(), 'long')            // 'April 6, 2026'

// Switch locale
i18n.locale('fr')

// Load from JSON files
await loadTranslations(i18n, './locales')
```

---

### Search

Full-text search with multiple backend drivers.

```ts
import { createSearch } from '@loewen-digital/fullstack/search'

const search = createSearch({ driver: 'sqlite-fts' })

// Index documents
await search.index('posts', [
  { id: '1', title: 'Getting Started', body: '...' },
  { id: '2', title: 'Advanced Topics', body: '...' },
])

// Search
const results = await search.search('posts', 'getting started')
// { hits: [{ id: '1', ... }], total: 1 }

await search.delete('posts', '1')
await search.flush('posts')
```

**Drivers:** `sqlite-fts` (built-in), `meilisearch`, `typesense`

---

### Webhooks

Verify incoming webhooks and track outgoing deliveries.

```ts
import { createWebhooks } from '@loewen-digital/fullstack/webhooks'

const webhooks = createWebhooks({ secret: env('WEBHOOK_SECRET') })

// Incoming — verify signature
const valid = await webhooks.verify(request)
if (!valid) throw new UnauthorizedError('Invalid webhook signature')

// Outgoing — send with delivery tracking
const delivery = await webhooks.send({
  url: 'https://partner.com/hooks',
  event: 'order.placed',
  payload: { orderId: '123', total: 99.99 },
})
```

---

### Realtime

Channel-based pub/sub and Server-Sent Events.

```ts
import { createRealtime } from '@loewen-digital/fullstack/realtime'

const realtime = createRealtime()

// Create a channel
const channel = realtime.channel('notifications')

// Subscribe
const off = channel.subscribe((event, data) => {
  console.log(event, data)
})

// Broadcast
channel.broadcast('new-message', { text: 'Hello!' })

// SSE endpoint (returns a standard Response)
const response = realtime.createSseResponse(channel)
```

---

## Framework Adapters

### SvelteKit

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { stack } from '$lib/server/stack'

export const handle = createHandle(stack, {
  csrf: { except: ['/api/webhooks'] },
})
```

```ts
// src/routes/+page.server.ts
import { stack } from '$lib/server/stack'
import { validateForm, setAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'

export const actions = {
  login: async ({ request, cookies, locals }) => {
    const data = await validateForm(request, {
      email:    'required|email',
      password: 'required|string',
    })

    const user = await stack.auth.validateCredentials(data.email, data.password)
    const token = await stack.auth.createSession(user.id)
    setAuthCookie(cookies, token)
  },
}
```

`locals` is enriched with `locals.session`, `locals.auth`, and `locals.csrfToken` automatically.

---

### Nuxt

```ts
// server/middleware/fullstack.ts
import { createNuxtMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
import { stack } from '~/server/stack'

export default createNuxtMiddleware(stack)
```

Access `event.context.session`, `event.context.auth`, and `event.context.csrfToken` in route handlers.

---

### Remix

```ts
// app/routes/login.tsx
import { createRemixLoader, createRemixAction } from '@loewen-digital/fullstack/adapters/remix'
import { stack } from '~/server/stack.server'

export const action = createRemixAction(stack, async ({ request, session, auth }) => {
  // session and auth injected automatically
})
```

---

### Astro

```ts
// src/middleware/index.ts
import { createAstroMiddleware } from '@loewen-digital/fullstack/adapters/astro'
import { stack } from '../lib/stack'

export const onRequest = createAstroMiddleware(stack)
```

Access `locals.fullstack.session` and `locals.fullstack.auth` in pages and API routes.

---

## Testing

`createTestStack()` returns a fully wired stack using in-memory drivers — no external services required.

```ts
import { createTestStack } from '@loewen-digital/fullstack/testing'

const stack = createTestStack()

// All drivers are in-memory and inspectable
await stack.mail.send({ to: 'a@b.com', subject: 'Hi', text: 'Hello' })
expect(stack.mail.sent).toHaveLength(1)

await stack.storage.put('file.txt', 'hello')
expect(await stack.storage.exists('file.txt')).toBe(true)

// Reset all fakes between tests
stack.reset()
```

**Factory helpers:**

```ts
import { defineFactory, sequence } from '@loewen-digital/fullstack/testing'

const UserFactory = defineFactory({
  definition: () => ({
    id: sequence(),
    name: 'Alice',
    email: `user-${sequence()}@example.com`,
    role: 'viewer',
  }),
})

const user  = UserFactory.make()
const admin = UserFactory.make({ role: 'admin' })
const users = UserFactory.makeMany(10)
```

**Database helpers:**

```ts
import { withSavepoint, createDbCleaner } from '@loewen-digital/fullstack/testing'

// Wrap each test in a transaction that rolls back automatically
const cleaner = createDbCleaner(db)
beforeEach(() => cleaner.start())
afterEach(() => cleaner.rollback())
```

---

## CLI

```bash
npx fullstack migrate               # Run pending migrations
npx fullstack migrate:rollback      # Roll back last migration
npx fullstack migrate:status        # Show migration status
npx fullstack seed                  # Run database seeds

npx fullstack generate migration create_users_table
npx fullstack generate factory user
npx fullstack generate seed users
```

---

## Vite Plugin

Adds config loading, HMR, and a virtual module for accessing config in your app:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'

export default defineConfig({
  plugins: [fullstackPlugin()],
})
```

```ts
// Anywhere in your app
import config from 'virtual:fullstack/config'
```

---

## Requirements

- **Node.js** 20+
- **TypeScript** 5.0+ (strict mode recommended)
- **ESM only** — this package does not ship CommonJS

---

## License

MIT
