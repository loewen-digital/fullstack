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

- [x] Implement `createDb(config)` — wraps Drizzle ORM
- [x] Support drivers: `sqlite`, `postgres`, `mysql`, `d1` (Cloudflare)
- [x] Implement migration runner: `migrate()`, `rollback()`, `status()`
- [x] Implement seed runner: `seed()`
- [x] Implement factory builder for test data
- [x] Implement `paginate()` helper — returns `{ data, total, page, perPage, lastPage }`
- [x] CLI integration points: expose functions for `migrate`, `seed`, `generate` commands
- [x] Write tests (using SQLite in-memory)
- [x] Export from `@loewen-digital/fullstack/db`

### Task 3.2: Security Module

- [x] Implement `createSecurity(config)` — returns security utilities
- [x] CSRF: `generateToken()`, `verifyToken(token)` using Node crypto
- [x] CORS: `corsHeaders(origin, config)` — returns headers object
- [x] Rate limiting: `createRateLimiter(config)` — in-memory (swappable driver later)
- [x] Input sanitization: `sanitize(input)` — strip dangerous HTML/scripts
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/security`

### Task 3.3: Session Module

- [x] Implement `createSession(config)` — returns session manager
- [x] Cookie driver: signed cookies, configurable maxAge
- [x] Memory driver: server-side sessions (for dev/testing)
- [x] Redis driver: server-side sessions via Redis
- [x] Flash messages: `flash(key, value)`, `getFlash(key)`
- [x] Old input: `flashInput(data)`, `getOldInput()`
- [x] Driver interface `SessionDriver` for custom implementations
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/session`

### Task 3.4: Auth Module

- [x] Implement `createAuth(config, { db })` — requires db instance
- [x] Password hashing: `hashPassword()`, `verifyPassword()` (argon2 preferred, bcrypt fallback)
- [x] Session-based auth: `createSession(user)`, `validateSession(token)`, `destroySession(token)`
- [x] Token-based auth: `generateToken(user, type)`, `verifyToken(token, type)`
- [x] Email verification: `sendVerificationEmail()`, `verifyEmail(token)`
- [x] Password reset: `sendResetEmail()`, `resetPassword(token, newPassword)`
- [x] OAuth scaffold: `createOAuthProvider(name, config)` — returns redirect URL + callback handler
- [x] Define User type contract (what the auth module expects from the DB user table)
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/auth`

-----

## Phase 4: Infrastructure Modules

### Task 4.1: Mail Module

- [x] Implement `createMail(config)` — returns mail sender
- [x] Console driver: logs to console, captures in-memory for dev UI
- [x] SMTP driver: sends via SMTP (nodemailer)
- [x] Resend driver: sends via Resend API
- [x] Postmark driver: sends via Postmark API
- [x] `send(message)` — send immediately
- [x] HTML template support (simple variable interpolation)
- [x] Driver interface `MailDriver` for custom transports
- [x] Write tests (using console driver)
- [x] Export from `@loewen-digital/fullstack/mail`

### Task 4.2: Storage Module

- [x] Implement `createStorage(config)` — returns file storage
- [x] Local driver: filesystem-based storage
- [x] S3 driver: AWS S3 compatible
- [x] R2 driver: Cloudflare R2
- [x] Memory driver: in-memory (for tests)
- [x] API: `get`, `put`, `delete`, `exists`, `list`, `getUrl`
- [x] Driver interface `StorageDriver` for custom backends
- [x] Write tests (using memory driver)
- [x] Export from `@loewen-digital/fullstack/storage`

### Task 4.3: Cache Module

- [x] Implement `createCache(config)` — returns cache instance
- [x] Memory driver: in-process Map with TTL
- [x] Redis driver: Redis-backed cache
- [x] KV driver: Cloudflare KV
- [x] API: `get`, `set`, `has`, `delete`, `flush`, `remember(key, ttl, fn)`
- [x] Driver interface `CacheDriver`
- [x] Write tests (using memory driver)
- [x] Export from `@loewen-digital/fullstack/cache`

### Task 4.4: Queue Module

- [x] Implement `createQueue(config)` — returns job dispatcher
- [x] Memory driver: synchronous execution (dev mode)
- [x] Redis driver: Redis-backed queue (BullMQ or custom)
- [x] Cloudflare driver: Cloudflare Queues
- [x] `dispatch(job)` — add job to queue
- [x] Job class: `name`, `payload`, `attempts`, `backoff`, `timeout`
- [x] Failed job handling: retry, dead letter
- [x] Driver interface `QueueDriver`
- [x] Write tests (using memory driver)
- [x] Export from `@loewen-digital/fullstack/queue`

-----

## Phase 5: Higher-Level Modules

### Task 5.1: Permissions Module

- [x] Implement `createPermissions(config, { db })` — returns permission checker
- [x] RBAC: define roles with permissions, assign roles to users
- [x] Policies: `definePolicy('post', { update: (user, post) => ... })`
- [x] `can(user, action, resource?)` — check permission
- [x] `authorize(user, action, resource?)` — throws if not allowed
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/permissions`

### Task 5.2: Notifications Module

- [x] Implement `createNotifications(config, { mail })` — requires mail instance
- [x] Mail channel: sends via mail module
- [x] In-app channel: stores in DB
- [x] SMS channel: driver-based (Twilio etc.)
- [x] Push channel: web push notifications
- [x] `notify(user, notification)` — send via configured channels
- [x] Notification class: `channels()`, `toMail()`, `toInApp()`, etc.
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/notifications`

### Task 5.3: Search Module

- [x] Implement `createSearch(config)` — returns search interface
- [x] SQLite FTS driver: built-in full-text search
- [x] Meilisearch driver
- [x] Typesense driver
- [x] API: `index(collection, documents)`, `search(collection, query, filters?)`
- [x] Driver interface `SearchDriver`
- [x] Write tests (using SQLite FTS)
- [x] Export from `@loewen-digital/fullstack/search`

### Task 5.4: Webhooks Module

- [x] Implement `createWebhooks(config)` — returns webhook manager
- [x] Incoming: signature verification (GitHub, Stripe, etc. patterns)
- [x] Outgoing: send with retry logic, signing
- [x] Webhook event log (optional DB storage)
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/webhooks`

### Task 5.5: Realtime Module

- [x] Implement `createRealtime(config)` — returns realtime manager
- [x] WebSocket support
- [x] SSE (Server-Sent Events) support
- [x] Channel/room abstraction
- [x] `broadcast(channel, event, data)` — send to all connected clients
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/realtime`

-----

## Phase 6: Integration

### Task 6.1: createStack Implementation

- [x] Implement `createStack(config)` — initializes all configured modules
- [x] Resolve inter-module dependencies (auth needs db, notifications needs mail, etc.)
- [x] TypeScript: return type is inferred from config (only configured modules are present)
- [x] Handle missing optional dependencies gracefully
- [x] Write integration tests
- [x] Export from `@loewen-digital/fullstack`

### Task 6.2: SvelteKit Adapter

- [x] Implement `createHandle(stack)` — returns SvelteKit `Handle` function
- [x] Populate `event.locals` with session, auth helpers, etc.
- [x] CSRF protection for non-GET requests
- [x] Type augmentation for `App.Locals`
- [x] Convenience helpers for form actions (validation, old input, flash)
- [x] Write tests with mock SvelteKit request/response
- [x] Export from `@loewen-digital/fullstack/adapters/sveltekit`

### Task 6.3: Testing Module

- [x] Implement `createTestStack(config?)` — pre-configured for testing
- [x] All drivers default to memory/fake
- [x] Fake mail: captures sent messages in array
- [x] Fake storage: in-memory file system
- [x] Fake queue: synchronous execution, captures dispatched jobs
- [x] DB helpers: transaction wrapping, automatic cleanup
- [x] Factory integration: standalone `defineFactory()` helper
- [x] Write tests (meta: tests for the testing module)
- [x] Export from `@loewen-digital/fullstack/testing`

-----

## Phase 7: Tooling

### Task 7.1: CLI

- [x] Implement CLI entry point (`bin/fullstack`)
- [x] `fullstack migrate` — run migrations
- [x] `fullstack migrate:rollback` — rollback last batch
- [x] `fullstack migrate:status` — show migration status
- [x] `fullstack seed` — run seeders
- [x] `fullstack generate migration <name>` — scaffold migration file
- [x] `fullstack generate factory <name>` — scaffold factory file
- [x] `fullstack generate seed <name>` — scaffold seed file
- [x] Register as `bin` in package.json
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/cli`

### Task 7.2: Vite Plugin

- [x] Implement `fullstackPlugin()` — Vite plugin
- [x] Auto-detect and load `fullstack.config.ts`
- [x] Dev server middleware for dev UI routes
- [x] Config file watching with auto-restart
- [x] Type generation hook (DB schema types on build)
- [x] Write tests
- [x] Export from `@loewen-digital/fullstack/vite`

### Task 7.3: Dev UI

- [x] Build dev UI dashboard (served via Vite plugin as self-contained SPA)
- [x] DB browser page: view tables, run queries, see migration status
- [x] Mail preview page: view captured emails (console driver)
- [x] Queue dashboard: view jobs, failed jobs, retry
- [x] Cache inspector: view keys, flush
- [x] Log viewer: structured log display with level filtering
- [x] Storage browser: view/download files
- [x] Config overview: display active configuration
- [x] Serve from Vite plugin at `/__fullstack/`

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
