---
title: Testing Overview
description: createTestStack, in-memory drivers and the SQLite helpers that keep tests isolated
---

# Testing Overview

Every module runs on an in-memory driver, so tests need no database server, mail service, Redis or object store. `createTestStack()` wires the common ones together with fake drivers that record what happened; the SQLite helpers roll a test's writes back or truncate tables between tests.

## Import

```ts
import { createTestStack } from '@loewen-digital/fullstack/testing'
```

## The test stack

`createTestStack()` returns an in-memory SQLite `db`, `mail`, `storage` and `queue` on fake drivers, `cache` on the memory driver and `session` on the memory driver, plus the three fakes for assertions and `reset()` to clear them. `auth` is not part of it: it needs an `AuthDbAdapter` for your schema (or flatdb's `MemoryAdapter`, see the [guide](/guides/auth-on-flatdb)).

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestStack, type TestStack } from '@loewen-digital/fullstack/testing'

async function welcome(stack: TestStack, email: string) {
  await stack.mail.send({ to: email, subject: 'Welcome!', text: 'Hi' })
  await stack.queue.dispatch({ name: 'sync-crm', payload: { email } })
}

describe('registration', () => {
  let stack: TestStack

  beforeEach(() => {
    stack = createTestStack() // fresh instances, empty fakes
  })

  it('sends the welcome mail and queues the sync', async () => {
    await welcome(stack, 'alice@example.com')

    expect(stack.fakeMail.sentTo('alice@example.com')).toHaveLength(1)
    expect(stack.fakeMail.lastSent()?.subject).toBe('Welcome!')
    expect(stack.fakeQueue.dispatched[0]?.name).toBe('sync-crm')
  })
})
```

A new stack per test is the simplest isolation. Keeping one stack and calling `stack.reset()` in `afterEach` clears mail, queue and storage but leaves the database, cache and sessions as they are. The database starts empty: run `stack.db.migrate('./drizzle')` in `beforeAll` when a test needs tables.

## Modules on their own

`createTestStack` is a convenience; each module has the same setup on its page. The console mail driver with `silent: true`, the memory drivers of cache, storage, queue and session, and an event bus need no test double at all.

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
import { createCache } from '@loewen-digital/fullstack/cache'
import { createQueue } from '@loewen-digital/fullstack/queue'
import { createSession } from '@loewen-digital/fullstack/session'

const mail = createMail({ driver: 'console', silent: true }) // mail.sent holds every message
const cache = createCache({ driver: 'memory' })
const queue = createQueue({ driver: 'memory' })
const session = createSession({ driver: 'memory' })
```

## Database isolation

Three helpers for the SQLite database, all on `db.drizzle`:

- `withSavepoint(drizzle, fn)` runs `fn` inside a savepoint and rolls it back afterwards, whether `fn` resolved or threw. The tables stay, the rows go.
- `createDbCleaner(drizzle)` gives `truncate(...tables)` (deletes all rows, foreign keys off meanwhile) and `resetSequences(...tables)` for predictable autoincrement ids.
- `seedOnce(db, fn)` runs a seed function and returns its result, for shared fixtures in `beforeAll`.

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { createDb } from '@loewen-digital/fullstack/db'
import { withSavepoint, createDbCleaner, seedOnce } from '@loewen-digital/fullstack/testing'

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
})

const db = createDb({ driver: 'sqlite', url: ':memory:' }, { users })
const cleaner = createDbCleaner(db.drizzle)

describe('users', () => {
  beforeAll(async () => {
    await db.migrate('./drizzle')
    await seedOnce(db, (db) => db.drizzle.insert(users).values({ email: 'seed@example.com' }))
  })

  afterEach(() => cleaner.resetSequences('users'))

  it('rolls a test back', async () => {
    await withSavepoint(db.drizzle, async (drizzle) => {
      await drizzle.insert(users).values({ email: 'temp@example.com' })
      expect(await drizzle.select().from(users)).toHaveLength(2)
    })
    expect(await db.drizzle.select().from(users)).toHaveLength(1)
  })
})
```

`withSavepoint` needs the synchronous `better-sqlite3` driver; it throws on anything else.

## In this section

- [Fakes](/testing/fakes): what the mail, queue and storage fakes record
- [Factories](/testing/factories): `defineFactory`, `sequence` and `pick` for test data
