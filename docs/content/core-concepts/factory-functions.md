---
title: Factory Functions
description: How and why @loewen-digital/fullstack uses factory functions instead of classes or service providers
---

# Factory Functions

Every module in `@loewen-digital/fullstack` is created with a `createX(config)` factory function. This is a deliberate design choice that prioritises simplicity, testability, and type safety.

## The pattern

```ts
// Every module follows this shape:
const instance = createX(config)
```

For example:

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
import { createCache } from '@loewen-digital/fullstack/cache'
import { createAuth } from '@loewen-digital/fullstack/auth'

const mail  = createMail({ driver: 'smtp', /* ... */ })
const cache = createCache({ driver: 'memory' })
const auth  = createAuth({ db, session: { driver: 'cookie', secret } })
```

## Why factory functions?

### No magic, no framework dependency

Service containers, decorators, and dependency injection frameworks are powerful but they require buy-in. Factory functions are plain TypeScript — no reflection metadata, no decorators, no DI container to configure. You call a function, you get back an object.

### Inferred TypeScript types

The return type of each factory function is **inferred from the config you pass**. If you configure the SMTP driver, TypeScript knows the mail instance has SMTP-specific properties. No manual type assertions required.

```ts
const mail = createMail({ driver: 'resend', resend: { apiKey: '...' } })
// mail is typed as MailInstance — TypeScript knows exactly what's available
```

### Easy to test

Swap any module for a test double by passing a different config or driver:

```ts
// In tests, use in-memory drivers — no external services needed
const mail  = createMail({ driver: 'memory' })
const cache = createCache({ driver: 'memory' })
const auth  = createAuth({ db: testDb, session: { driver: 'memory' } })
```

### Multiple instances

If you need two different mail configurations in the same app (e.g., transactional vs. marketing), just create two instances:

```ts
const transactional = createMail({ driver: 'resend', from: { address: 'tx@example.com' } })
const marketing     = createMail({ driver: 'postmark', from: { address: 'news@example.com' } })
```

### Tree-shakeable

Because everything is an explicit import and function call, bundlers can tree-shake unused modules. If you never import `createQueue`, it never ends up in your bundle.

## The returned instance

Factory functions return a plain object with methods — not a class instance. This means:

- No `this` binding issues
- Methods can be destructured safely
- Easy to serialize configuration (the instance itself holds no hidden state beyond what the config describes)

```ts
const { send } = createMail({ driver: 'console' })
await send({ to: 'user@example.com', subject: 'Hello', text: 'World' })
```

## Comparison with alternatives

| Approach | @loewen-digital/fullstack | DI Container | Singleton |
|---|---|---|---|
| Framework agnostic | Yes | Sometimes | Yes |
| Multiple instances | Yes | With scoping | No |
| TypeScript inference | Full | Partial | Full |
| Test isolation | Easy | Medium | Hard |
| Bundle size | Tree-shakeable | Often heavy | Varies |
