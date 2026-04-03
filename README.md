# @loewen-digital/fullstack

Backend primitives for any JavaScript meta-framework — auth, DB, validation, mail, storage, queue, and more.

Think "Laravel for the JS ecosystem" — but as a composable library, not a framework.

## Installation

```bash
npm install @loewen-digital/fullstack
```

## Quick Start

```ts
import { defineConfig, createStack } from '@loewen-digital/fullstack'

const config = defineConfig({
  db: { driver: 'sqlite', url: './data.db' },
  mail: { driver: 'console' },
})

export const stack = createStack(config)
```

## Modules

| Subpath | Description |
|---|---|
| `@loewen-digital/fullstack` | Core: `defineConfig`, `createStack` |
| `.../config` | Config loading, `env()` helper |
| `.../validation` | Stateless `validate()`, built-in rules |
| `.../auth` | Authentication, sessions, OAuth |
| `.../db` | Drizzle ORM wrapper, migrations, seeds |
| `.../session` | Session management |
| `.../security` | CSRF, CORS, rate limiting, sanitization |
| `.../mail` | Email sending, templates |
| `.../storage` | File storage (local, S3, R2) |
| `.../cache` | Caching (memory, Redis, KV) |
| `.../logging` | Structured logging |
| `.../errors` | HTTP error classes, error handler |
| `.../queue` | Job queue |
| `.../events` | In-process event bus |
| `.../notifications` | Multi-channel notifications |
| `.../i18n` | Internationalization |
| `.../search` | Full-text search |
| `.../permissions` | RBAC, policies |
| `.../webhooks` | Incoming/outgoing webhooks |
| `.../realtime` | WebSocket, SSE |
| `.../testing` | Test helpers, fakes, factories |
| `.../adapters/sveltekit` | SvelteKit adapter |

## License

MIT
