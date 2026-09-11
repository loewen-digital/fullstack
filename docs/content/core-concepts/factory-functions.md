---
title: Factory Functions
description: Every module is a createX(config) call that returns a plain object; no classes, no container
---

# Factory Functions

Every module in `@loewen-digital/fullstack` is created by a `createX(config)` function that returns a plain object with methods. No classes to extend, no service container to register with, no decorators: a function call, an object back.

## The pattern

```ts
import { createCache } from '@loewen-digital/fullstack/cache'
import { createMail } from '@loewen-digital/fullstack/mail'
import { createAuth, type AuthDbAdapter } from '@loewen-digital/fullstack/auth'

declare const authDb: AuthDbAdapter // your storage, see the auth page

const cache = createCache({ driver: 'memory' })
const mail = createMail({ driver: 'console', from: 'My App <hello@example.com>' })
const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db: authDb })
```

Dependencies between modules are the second argument: `auth` takes its storage adapter, `notifications` takes `mail`. Nothing is looked up from a global.

## Two-level factories

Modules with drivers have two factories. `createX(config)` takes a driver name and builds the drivers that need nothing else (`memory`, `console`, `cookie`, `sqlite`). `createXInstance(driver)` takes a driver object, for drivers with credentials or clients, and for your own.

```ts
import { createMailInstance, createResendDriver } from '@loewen-digital/fullstack/mail'
import { createCacheInstance, createMemoryDriver } from '@loewen-digital/fullstack/cache'

const resend = createMailInstance(createResendDriver({ apiKey: process.env.RESEND_API_KEY! }), {
  driver: 'resend',
  from: 'My App <hello@example.com>',
})
const cacheOnDriver = createCacheInstance(createMemoryDriver(), 3600) // default TTL in seconds
```

The [driver pattern](/core-concepts/driver-pattern) page has the full list.

## Why factory functions

### No framework dependency

A factory is plain TypeScript: no reflection metadata, no container configuration, nothing a bundler has to understand. It runs wherever the code runs, in a SvelteKit hook, a Worker, a test.

### Types where they matter

The instance types are fixed per module (`MailInstance`, `CacheInstance`, ...); a driver does not change them. Inference happens where the shape depends on your input: `createStack` returns only the modules the config names, `validate` types its `data` from the rules, `createDb(config, schema)` types `drizzle` from the schema.

```ts
import { createStack } from '@loewen-digital/fullstack'
import { validate } from '@loewen-digital/fullstack/validation'

const stack = createStack({ cache: { driver: 'memory' }, mail: { driver: 'console' } })
// stack.cache and stack.mail exist; stack.db is a type error

async function parse(input: Record<string, unknown>) {
  const result = await validate(input, { email: 'required|email', age: 'optional|number' })
  if (result.ok) return result.data // { email: string; age?: number }
  return null
}
```

### Easy to test

The bundled drivers are the test doubles: the console mail driver keeps every message in `sent`, memory drivers hold data in a `Map`, and an `AuthDbAdapter` on `MemoryAdapter` from flatdb (or a hand-written one) gives `auth` a store without a database.

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

async function sendsWelcomeMail() {
  const mail = createMail({ driver: 'console', silent: true }) // no console output
  await mail.send({ to: 'user@example.com', subject: 'Welcome', text: 'Hi' })
  return mail.sent.length === 1 && mail.sent[0]?.subject === 'Welcome'
}
```

### Multiple instances

Two mail configurations in one app are two calls. Each instance holds only what its config and driver hold.

```ts
import { createMailInstance, createResendDriver, createPostmarkDriver } from '@loewen-digital/fullstack/mail'

const transactional = createMailInstance(createResendDriver({ apiKey: process.env.RESEND_API_KEY! }), {
  driver: 'resend',
  from: 'tx@example.com',
})
const marketing = createMailInstance(createPostmarkDriver({ serverToken: process.env.POSTMARK_TOKEN! }), {
  driver: 'postmark',
  from: 'news@example.com',
})
```

### Tree-shakeable

Every module is its own subpath (`@loewen-digital/fullstack/mail`), so what you do not import is not in the bundle. Inside a module the drivers are small and talk HTTP through `fetch`; the two that load a package (`nodemailer` for SMTP, `better-sqlite3` for db) do so lazily.

## The returned instance

A factory returns an object literal of closures over its config and driver, not a class instance. There is no `this`, so methods can be passed around and destructured.

```ts
import { createMail } from '@loewen-digital/fullstack/mail'

const { send } = createMail({ driver: 'console' })

async function notify() {
  await send({ to: 'user@example.com', subject: 'Hello', text: 'World' })
}
```

## Compared with the alternatives

| | Factory functions | DI container | Module singleton |
|---|---|---|---|
| Framework agnostic | yes | depends on the container | yes |
| Several instances | a second call | with scopes | no |
| Types | from the config and rules you pass | partial | full |
| Test setup | a bundled driver | container configuration | mocking modules |
| Bundle | subpath imports, tree-shakeable | the container plus reflection | varies |
