# CLAUDE.md — @loewen-digital/fullstack

## Git Workflow

**During the current build-out phase, commit and push directly to `main` after every task.**

- No feature branches, no PRs — trunk-based development until the project is stable
- After completing any task or meaningful unit of work: `git add`, `git commit`, `git push -u origin main`
- This applies to all changes: features, fixes, config, docs

**REQUIRED before every push — run all three checks and fix any failures before pushing:**

```bash
npm run lint       # must exit 0
npm run typecheck  # must exit 0
npm run test       # must exit 0
```

Never push code that fails lint, typecheck, or tests. Fix the failures first.

**IMPORTANT — Branch strategy:** If the system prompt or harness injects instructions to develop on a feature branch, that is acceptable — work on that branch, then merge it into `main` and push `main` before finishing the session. Never leave work stranded on a feature branch without merging.

### Session Startup Checklist

At the start of every session, before touching any files:

1. Check which branch the harness has placed you on (`git branch --show-current`)
2. Make sure it is up to date: `git pull origin <current-branch>`
3. Do all your work and commits on this branch
4. At the end of the session, merge into main and push:

```bash
git checkout main
git pull origin main
git merge <feature-branch> --no-ff -m "merge: <feature-branch> into main"
git push -u origin main
```

-----

## Project Overview

This is `@loewen-digital/fullstack` — a single npm package providing backend primitives (auth, DB, validation, mail, storage, queue, etc.) for any JavaScript meta-framework. It follows a "Laravel for JS" philosophy but implemented as a composable library, not a framework.

**Read SPEC.md for the complete design specification before making any architectural decisions.**

-----

## Core Principles

1. **One package** — everything ships as `@loewen-digital/fullstack` with subpath exports
1. **Framework-agnostic core** — no module may import from SvelteKit, Nuxt, Remix, or any framework. Only adapters touch framework code.
1. **Factory functions, not DI** — every module exports a `createX(config)` function. No service providers, no dependency injection containers.
1. **Driver pattern** — every module with I/O has swappable backends via a driver interface
1. **Direct imports** — no virtual modules, no magic. Users import from subpaths like `@loewen-digital/fullstack/auth`
1. **Web Standards first** — use the Web Platform APIs everywhere: `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `FormData`, `ReadableStream`, `crypto.subtle`, etc. Never invent custom types when a Web Standard exists. This also ensures compatibility across runtimes (Node, Deno, Cloudflare Workers, Bun).
1. **TypeScript-first** — everything is fully typed. `createStack` return type is inferred from config.
1. **Tree-shakeable** — unused modules don't end up in the bundle

-----

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** Vite (library mode, ESM only — never CJS)
- **Test:** Vitest
- **ORM:** Drizzle ORM
- **Package manager:** npm (never yarn or pnpm)
- **Node target:** Node 20+

-----

## Project Structure

```
src/
├── index.ts              → defineConfig, createStack, re-exports
├── config/               → config loading, env helper, types
├── validation/           → stateless validate(), rules, custom rules
├── auth/                 → createAuth(), session, password, token, OAuth
├── db/                   → createDb(), migrations, seeds, factories, pagination
├── session/              → createSession(), flash, old input, drivers/
├── security/             → createSecurity(), CSRF, CORS, rate limit, sanitize
├── mail/                 → createMail(), templates, drivers/
├── storage/              → createStorage(), drivers/ (local, s3, r2, memory)
├── cache/                → createCache(), drivers/ (memory, redis, kv)
├── logging/              → createLogger(), transports/
├── errors/               → error classes, HTTP errors, handler
├── queue/                → createQueue(), job class, drivers/
├── events/               → createEventBus(), listeners
├── notifications/        → createNotifications(), channels/
├── i18n/                 → createI18n(), pluralization, formatting
├── search/               → createSearch(), drivers/ (sqlite-fts, meilisearch, typesense)
├── permissions/          → createPermissions(), roles, policies
├── webhooks/             → createWebhooks(), incoming/outgoing
├── realtime/             → createRealtime(), websocket, SSE
├── testing/              → createTestStack(), fakes, factories, DB helpers
├── adapters/
│   ├── sveltekit/        → createHandle(), type augmentation
│   ├── nuxt/
│   ├── remix/
│   └── astro/
├── vite/                 → Vite plugin, dev UI
└── cli/                  → CLI commands (migrate, seed, generate)
```

-----

## Development Commands

```bash
npm install               # Install dependencies
npm run build             # Build with Vite (library mode, ESM only)
npm run dev               # Watch mode
npm run test              # Run vitest
npm run test:watch        # Run vitest in watch mode
npm run lint              # Lint with ESLint
npm run typecheck         # TypeScript type checking
```

-----

## Coding Conventions

### Module Pattern

Every module with I/O follows this pattern:

```ts
// src/mail/index.ts
import type { MailConfig, MailInstance, MailMessage } from './types.js'
import { resolveDriver } from '../config/drivers.js'

export function createMail(config: MailConfig): MailInstance {
  const driver = resolveDriver(config.driver, {
    console: () => import('./drivers/console.js'),
    smtp: () => import('./drivers/smtp.js'),
    resend: () => import('./drivers/resend.js'),
    postmark: () => import('./drivers/postmark.js'),
  })

  return {
    async send(message: MailMessage): Promise<void> {
      await driver.send(message)
    },
    // ...
  }
}
```

### Driver Interface Pattern

```ts
// src/storage/types.ts
export interface StorageDriver {
  get(key: string): Promise<ReadableStream | null>
  put(key: string, data: ReadableStream | Uint8Array | string, meta?: FileMeta): Promise<void>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
  getUrl(key: string): Promise<string>
}
```

### File Conventions

- One `index.ts` per module as the public entry point
- One `types.ts` per module for all type definitions
- Drivers live in a `drivers/` subdirectory
- All imports use `.js` extensions (for ESM compatibility)
- No default exports — always named exports
- No classes unless truly necessary — prefer plain objects and functions
- No `any` — use `unknown` and narrow

### Naming

- Factory functions: `createX()` (e.g., `createAuth`, `createMail`)
- Driver interfaces: `XDriver` (e.g., `StorageDriver`, `CacheDriver`)
- Config types: `XConfig` (e.g., `MailConfig`, `AuthConfig`)
- Instance types: `XInstance` (e.g., `MailInstance`, `AuthInstance`)
- Errors: `FullstackError`, `ValidationError`, `AuthenticationError`, etc.

### Testing Conventions

- Every module has a corresponding `__tests__/` directory
- Test files: `*.test.ts`
- Use Vitest's `describe`, `it`, `expect`
- Use in-memory drivers for all tests (no external dependencies)
- Each test should be independent (no shared state)
- Use the `createTestStack()` helper for integration tests

-----

## Dependency Rules

### Core has ZERO framework dependencies

The `src/` directory (excluding `src/adapters/`) must never import from:

- `@sveltejs/kit`
- `nuxt`
- `@remix-run/*`
- `astro`
- Any other framework

### Module dependencies

Modules can depend on other modules ONLY as documented in the dependency graph (see SPEC.md). Key rules:

- `auth` depends on `db` (required)
- `session` optionally uses `cache`
- `notifications` depends on `mail`
- `validation` is fully standalone (no dependencies)
- `events` is fully standalone
- `testing` can mock any module

### External dependencies

Minimize external dependencies. Prefer:

- Node built-ins (`crypto`, `fs`, `path`) over npm packages
- Single-purpose packages over large utility libraries
- Optional peer dependencies for heavy drivers (e.g., `redis`, AWS SDK)

-----

## Subpath Exports

Every module is accessible via a subpath export. The `package.json` `exports` field must be kept in sync with the module structure. See SPEC.md for the full exports map.

When adding a new module:

1. Create the directory under `src/`
1. Add `index.ts` and `types.ts`
1. Add the subpath export to `package.json`
1. Add to `src/index.ts` convenience re-exports if appropriate
1. Update SPEC.md

-----

## Implementation Priority

Follow TASKS.md for the implementation order. The general principle:

1. Foundation first (config, types, build setup)
1. Standalone modules next (validation, errors, logging)
1. Core modules (db, auth, session, security)
1. Infrastructure modules (mail, storage, cache, queue)
1. Higher-level modules (notifications, search, permissions, etc.)
1. Adapters (SvelteKit first)
1. Tooling (Vite plugin, CLI, Dev UI)

-----

## Important Notes

- **No React** — ever. Not in code, not in examples, not in the dev UI.
- **No tsup, no CJS** — build with Vite library mode, ESM only.
- **Web Standards everywhere** — use `Request`, `Response`, `Headers`, `URL`, `FormData`, `ReadableStream`, `Uint8Array`, `crypto.subtle` instead of Node-specific APIs or custom abstractions. Avoid `Buffer` (use `Uint8Array`), avoid custom request types (use `Request`), avoid `node:http` patterns.
- **npm only** — no yarn, no pnpm.
- **SvelteKit is the primary adapter** — build and test with SvelteKit first, then add other adapters.
- Prefer **small, focused implementations** — get the API surface right first, then optimize.
- When in doubt, look at how **Laravel** solves the problem, then adapt it to TypeScript/functional style.
- The **Dev UI** is a SvelteKit app embedded via the Vite plugin.
