# TASKS.md — @loewen-digital/fullstack

Implementation tasks in dependency order. Each task is self-contained and results in working, tested code.

-----

## Phase 1: Foundation

### Task 1.1: Project Scaffolding

- [x] Initialize npm project with `package.json` (name: `@loewen-digital/fullstack`)
- [x] Set up TypeScript with strict mode (`tsconfig.json`)
- [x] Set up Vite for library mode build, ESM only (`vite.config.ts`)
- [x] Set up Vitest (`vitest.config.ts`)
- [x] Set up ESLint with TypeScript rules
- [x] Create directory structure as defined in SPEC.md
- [x] Set up subpath exports in `package.json` (start with `"."` and `"./config"`)
- [x] Verify build, test, and lint commands work
- [x] Add `.gitignore`, `LICENSE`, `README.md` stubs

### Task 1.2: Config Module

- [x] Implement `defineConfig()` — typed config builder with sensible defaults
- [x] Implement `loadConfig()` — reads `fullstack.config.ts` from project root
- [x] Implement `env()` helper — type-safe environment variable access with fallbacks
- [x] Implement driver resolution utility (`resolveDriver`) — lazy-loads driver based on config string
- [x] Define `FullstackConfig` master type (all module configs as optional properties)
- [x] Write tests for config loading, env helper, driver resolution
- [x] Export from `@loewen-digital/fullstack` and `@loewen-digital/fullstack/config`

### Task 1.3: Error Module

- [x] Create base `FullstackError` class (extends Error, adds `code`, `statusCode`, `context`)
- [x] Create HTTP error classes: `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `ConflictError`, `RateLimitError`, `InternalError`
- [x] Create module-specific errors: `ConfigError`, `DatabaseError`, `AuthError`, `MailError`, `StorageError`
- [x] Implement error handler utility (formats errors for different contexts: JSON API, HTML, log)
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/errors`

-----

## Phase 2: Standalone Modules

### Task 2.1: Validation Module

- [x] Implement `validate(data, rules)` — returns `{ ok: true, data }` or `{ ok: false, errors }`
- [x] Implement string rule parser: `'required|string|max:255'` → rule objects
- [x] Implement object rule format: `{ required: true, type: 'string', max: 255 }`
- [x] Built-in rules: `required`, `optional`, `nullable`, `string`, `number`, `boolean`, `array`, `object`
- [x] Built-in rules: `min`, `max`, `email`, `url`, `in`, `regex`, `uuid`, `date`, `before`, `after`
- [x] Built-in rule: `confirmed` (checks `{field}_confirmation`)
- [x] Implement `defineRules()` for custom rule registration
- [x] Implement nested object validation (`address.street`: `'required|string'`)
- [x] Implement array item validation (`tags.*`: `'string|max:50'`)
- [x] TypeScript: infer validated data type from rules
- [x] Write comprehensive tests (happy path, errors, edge cases, custom rules)
- [x] Export from `@loewen-digital/fullstack/validation`

### Task 2.2: Logging Module

- [x] Implement `createLogger(config)` — returns logger instance
- [x] Log levels: `debug`, `info`, `warn`, `error`, `fatal`
- [x] Structured logging (JSON format with timestamp, level, message, context)
- [x] Console transport (with colors in dev, JSON in prod)
- [x] File transport (rotating log files)
- [x] Driver interface `LogTransport` for custom transports
- [x] Child loggers with inherited context: `logger.child({ module: 'auth' })`
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/logging`

### Task 2.3: Events Module

- [x] Implement `createEventBus()` — typed pub/sub within the app
- [x] `emit(event, payload)` — fire event
- [x] `on(event, listener)` — register listener
- [x] `off(event, listener)` — remove listener
- [x] `once(event, listener)` — listen once
- [x] Typed events: `defineEvents<{ 'user.created': User, 'post.published': Post }>()`
- [x] Optional: async listeners, error handling in listeners
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/events`

### Task 2.4: i18n Module

- [x] Implement `createI18n(config)` — returns translation functions
- [x] `t(key, params?)` — translate with optional interpolation
- [x] `locale(name)` — switch locale
- [x] Load translation files from directory (JSON format)
- [x] Pluralization support
- [x] Number and date formatting per locale
- [x] Nested translation keys: `t('auth.errors.invalid_password')`
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/i18n`

-----

## Phase 3: Core Modules

### Task 3.1: Database Module

- [ ] Implement `createDb(config)` — wraps Drizzle ORM
- [ ] Support drivers: `sqlite`, `postgres`, `mysql`, `d1` (Cloudflare)
- [ ] Implement migration runner: `migrate()`, `rollback()`, `status()`
- [ ] Implement seed runner: `seed()`
- [ ] Implement factory builder for test data
- [ ] Implement `paginate()` helper — returns `{ data, total, page, perPage, lastPage }`
- [ ] CLI integration points: expose functions for `migrate`, `seed`, `generate` commands
- [ ] Write tests (using SQLite in-memory)
- [ ] Export from `@loewen-digital/fullstack/db`

### Task 3.2: Security Module

- [ ] Implement `createSecurity(config)` — returns security utilities
- [ ] CSRF: `generateToken()`, `verifyToken(token)` using Node crypto
- [ ] CORS: `corsHeaders(origin, config)` — returns headers object
- [ ] Rate limiting: `createRateLimiter(config)` — in-memory (swappable driver later)
- [ ] Input sanitization: `sanitize(input)` — strip dangerous HTML/scripts
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/security`

### Task 3.3: Session Module

- [ ] Implement `createSession(config)` — returns session manager
- [ ] Cookie driver: signed cookies, configurable maxAge
- [ ] Memory driver: server-side sessions (for dev/testing)
- [ ] Redis driver: server-side sessions via Redis
- [ ] Flash messages: `flash(key, value)`, `getFlash(key)`
- [ ] Old input: `flashInput(data)`, `getOldInput()`
- [ ] Driver interface `SessionDriver` for custom implementations
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/session`

### Task 3.4: Auth Module

- [ ] Implement `createAuth(config, { db })` — requires db instance
- [ ] Password hashing: `hashPassword()`, `verifyPassword()` (argon2 preferred, bcrypt fallback)
- [ ] Session-based auth: `createSession(user)`, `validateSession(token)`, `destroySession(token)`
- [ ] Token-based auth: `generateToken(user, type)`, `verifyToken(token, type)`
- [ ] Email verification: `sendVerificationEmail()`, `verifyEmail(token)`
- [ ] Password reset: `sendResetEmail()`, `resetPassword(token, newPassword)`
- [ ] OAuth scaffold: `createOAuthProvider(name, config)` — returns redirect URL + callback handler
- [ ] Define User type contract (what the auth module expects from the DB user table)
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/auth`

-----

## Phase 4: Infrastructure Modules

### Task 4.1: Mail Module

- [ ] Implement `createMail(config)` — returns mail sender
- [ ] Console driver: logs to console, captures in-memory for dev UI
- [ ] SMTP driver: sends via SMTP (nodemailer)
- [ ] Resend driver: sends via Resend API
- [ ] Postmark driver: sends via Postmark API
- [ ] `send(message)` — send immediately
- [ ] HTML template support (simple variable interpolation)
- [ ] Driver interface `MailDriver` for custom transports
- [ ] Write tests (using console driver)
- [ ] Export from `@loewen-digital/fullstack/mail`

### Task 4.2: Storage Module

- [ ] Implement `createStorage(config)` — returns file storage
- [ ] Local driver: filesystem-based storage
- [ ] S3 driver: AWS S3 compatible
- [ ] R2 driver: Cloudflare R2
- [ ] Memory driver: in-memory (for tests)
- [ ] API: `get`, `put`, `delete`, `exists`, `list`, `getUrl`
- [ ] Driver interface `StorageDriver` for custom backends
- [ ] Write tests (using memory driver)
- [ ] Export from `@loewen-digital/fullstack/storage`

### Task 4.3: Cache Module

- [ ] Implement `createCache(config)` — returns cache instance
- [ ] Memory driver: in-process Map with TTL
- [ ] Redis driver: Redis-backed cache
- [ ] KV driver: Cloudflare KV
- [ ] API: `get`, `set`, `has`, `delete`, `flush`, `remember(key, ttl, fn)`
- [ ] Driver interface `CacheDriver`
- [ ] Write tests (using memory driver)
- [ ] Export from `@loewen-digital/fullstack/cache`

### Task 4.4: Queue Module

- [ ] Implement `createQueue(config)` — returns job dispatcher
- [ ] Memory driver: synchronous execution (dev mode)
- [ ] Redis driver: Redis-backed queue (BullMQ or custom)
- [ ] Cloudflare driver: Cloudflare Queues
- [ ] `dispatch(job)` — add job to queue
- [ ] Job class: `name`, `payload`, `attempts`, `backoff`, `timeout`
- [ ] Failed job handling: retry, dead letter
- [ ] Driver interface `QueueDriver`
- [ ] Write tests (using memory driver)
- [ ] Export from `@loewen-digital/fullstack/queue`

-----

## Phase 5: Higher-Level Modules

### Task 5.1: Permissions Module

- [ ] Implement `createPermissions(config, { db })` — returns permission checker
- [ ] RBAC: define roles with permissions, assign roles to users
- [ ] Policies: `definePolicy('post', { update: (user, post) => ... })`
- [ ] `can(user, action, resource?)` — check permission
- [ ] `authorize(user, action, resource?)` — throws if not allowed
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/permissions`

### Task 5.2: Notifications Module

- [ ] Implement `createNotifications(config, { mail })` — requires mail instance
- [ ] Mail channel: sends via mail module
- [ ] In-app channel: stores in DB
- [ ] SMS channel: driver-based (Twilio etc.)
- [ ] Push channel: web push notifications
- [ ] `notify(user, notification)` — send via configured channels
- [ ] Notification class: `channels()`, `toMail()`, `toInApp()`, etc.
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/notifications`

### Task 5.3: Search Module

- [ ] Implement `createSearch(config)` — returns search interface
- [ ] SQLite FTS driver: built-in full-text search
- [ ] Meilisearch driver
- [ ] Typesense driver
- [ ] API: `index(collection, documents)`, `search(collection, query, filters?)`
- [ ] Driver interface `SearchDriver`
- [ ] Write tests (using SQLite FTS)
- [ ] Export from `@loewen-digital/fullstack/search`

### Task 5.4: Webhooks Module

- [ ] Implement `createWebhooks(config)` — returns webhook manager
- [ ] Incoming: signature verification (GitHub, Stripe, etc. patterns)
- [ ] Outgoing: send with retry logic, signing
- [ ] Webhook event log (optional DB storage)
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/webhooks`

### Task 5.5: Realtime Module

- [ ] Implement `createRealtime(config)` — returns realtime manager
- [ ] WebSocket support
- [ ] SSE (Server-Sent Events) support
- [ ] Channel/room abstraction
- [ ] `broadcast(channel, event, data)` — send to all connected clients
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/realtime`

-----

## Phase 6: Integration

### Task 6.1: createStack Implementation

- [ ] Implement `createStack(config)` — initializes all configured modules
- [ ] Resolve inter-module dependencies (auth needs db, notifications needs mail, etc.)
- [ ] TypeScript: return type is inferred from config (only configured modules are present)
- [ ] Handle missing optional dependencies gracefully
- [ ] Write integration tests
- [ ] Export from `@loewen-digital/fullstack`

### Task 6.2: SvelteKit Adapter

- [ ] Implement `createHandle(stack)` — returns SvelteKit `Handle` function
- [ ] Populate `event.locals.fullstack` with session, auth helpers, etc.
- [ ] CSRF protection for non-GET requests
- [ ] Type augmentation for `App.Locals`
- [ ] Convenience helpers for form actions (validation, old input, flash)
- [ ] Write tests with mock SvelteKit request/response
- [ ] Export from `@loewen-digital/fullstack/adapters/sveltekit`

### Task 6.3: Testing Module

- [ ] Implement `createTestStack(config?)` — pre-configured for testing
- [ ] All drivers default to memory/fake
- [ ] Fake mail: captures sent messages in array
- [ ] Fake storage: in-memory file system
- [ ] Fake queue: synchronous execution, captures dispatched jobs
- [ ] DB helpers: transaction wrapping, automatic cleanup
- [ ] Factory integration: `stack.db.factory('user').create()`
- [ ] Write tests (meta: tests for the testing module)
- [ ] Export from `@loewen-digital/fullstack/testing`

-----

## Phase 7: Tooling

### Task 7.1: CLI

- [ ] Implement CLI entry point (`bin/fullstack`)
- [ ] `fullstack migrate` — run migrations
- [ ] `fullstack migrate:rollback` — rollback last batch
- [ ] `fullstack migrate:status` — show migration status
- [ ] `fullstack seed` — run seeders
- [ ] `fullstack generate migration <name>` — scaffold migration file
- [ ] `fullstack generate factory <name>` — scaffold factory file
- [ ] `fullstack generate seed <name>` — scaffold seed file
- [ ] Register as `bin` in package.json
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/cli`

### Task 7.2: Vite Plugin

- [ ] Implement `fullstackPlugin()` — Vite plugin
- [ ] Auto-detect and load `fullstack.config.ts`
- [ ] Dev server middleware for dev UI routes
- [ ] Config file watching with auto-restart
- [ ] Type generation hook (DB schema types on build)
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/vite`

### Task 7.3: Dev UI

- [ ] Build dev UI dashboard (SvelteKit app, served via Vite plugin)
- [ ] DB browser page: view tables, run queries, see migration status
- [ ] Mail preview page: view captured emails (console driver)
- [ ] Queue dashboard: view jobs, failed jobs, retry
- [ ] Cache inspector: view keys, flush
- [ ] Log viewer: structured log display with level filtering
- [ ] Storage browser: view/download files
- [ ] Config overview: display active configuration
- [ ] Serve from Vite plugin at `/__fullstack/`

-----

## Phase 8: Additional Adapters

### Task 8.1: Nuxt Adapter

- [ ] Implement adapter for Nuxt/Nitro server routes
- [ ] Server middleware integration
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/adapters/nuxt`

### Task 8.2: Remix Adapter

- [ ] Implement adapter for Remix loader/action pattern
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/adapters/remix`

### Task 8.3: Astro Adapter

- [ ] Implement adapter for Astro API routes and SSR
- [ ] Write tests
- [ ] Export from `@loewen-digital/fullstack/adapters/astro`

-----

## Phase 9: Polish

### Task 9.1: Documentation

- [ ] Comprehensive README.md with quick start
- [ ] Per-module documentation in docs/ directory
- [ ] API reference (generated from TSDoc comments)
- [ ] Example project: SvelteKit blog with fullstack

### Task 9.2: CI/CD

- [ ] GitHub Actions: test, lint, typecheck on PR
- [ ] Automated npm publish on release tag
- [ ] Changelog generation

### Task 9.3: Performance & Bundle Size

- [ ] Audit bundle size per subpath export
- [ ] Ensure tree-shaking works correctly
- [ ] Benchmark critical paths (validation, auth session check)
- [ ] Optimize hot paths if needed
