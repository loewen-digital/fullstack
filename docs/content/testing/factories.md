---
title: Factories
description: defineFactory, sequence and pick for test data, with or without a database
---

# Factories

`defineFactory` builds typed objects from per-field default functions, with overrides and named states. It persists nothing: the objects go into Drizzle's `insert`, a flatdb collection or straight into the function under test. Factories bound to a database are on the [db page](/modules/db#factories) (`db.factory`).

## Import

```ts
import { defineFactory, sequence, pick } from '@loewen-digital/fullstack/testing'
```

## Defining a factory

Every field is a function, so each `make` gets fresh values and no two objects share a `Date` or an array. `sequence()` returns a counter, `pick([...])` a random choice from the list.

```ts
import { defineFactory, sequence, pick } from '@loewen-digital/fullstack/testing'

const seq = sequence()

export const userFactory = defineFactory({
  email: () => `user${seq()}@example.com`,
  name: pick(['Alice', 'Bob', 'Carol']),
  role: () => 'user' as 'user' | 'admin',
  createdAt: () => new Date(),
})

const alice = userFactory.make({ name: 'Alice' }) // { email: 'user1@example.com', name: 'Alice', role: 'user', createdAt }
const five = userFactory.makeMany(5, { role: 'admin' })
```

The type of a record is inferred from the definition; `make` and `makeMany` take a `Partial` of it as overrides.

## States

`state(overrides)` returns a new factory with some defaults replaced; the original is unchanged.

```ts
export const adminFactory = userFactory.state({ role: () => 'admin' })

const admin = adminFactory.make() // role: 'admin', everything else as before
```

## Inserting records

The objects fit whatever store the test uses. With Drizzle:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { eq } from 'drizzle-orm'
import { createDb } from '@loewen-digital/fullstack/db'

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['user', 'admin'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

const db = createDb({ driver: 'sqlite', url: ':memory:' }, { users })

describe('admins', () => {
  beforeAll(() => db.migrate('./drizzle'))

  it('lists only admins', async () => {
    await db.drizzle.insert(users).values([...userFactory.makeMany(3), ...adminFactory.makeMany(2)])

    const admins = await db.drizzle.select().from(users).where(eq(users.role, 'admin'))
    expect(admins).toHaveLength(2)
  })
})
```

`db.factory({ build, insert })` from the db module wraps the same idea with an `insert` step, when a factory should persist by itself.

## Seeding

Development data is a seed file the [CLI](/tooling/cli) runs with `fullstack seed`; a factory keeps it short. In tests, `seedOnce(db, fn)` from the testing module runs a seed function in `beforeAll`.

```ts
import { seedOnce } from '@loewen-digital/fullstack/testing'

async function fixtures() {
  return seedOnce(db, async (db) => {
    await db.drizzle.insert(users).values(userFactory.makeMany(10))
    return db.drizzle.select().from(users)
  })
}
```
