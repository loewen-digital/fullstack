---
title: Database
description: createDb wraps Drizzle ORM on SQLite with migrations, seeds, factories and pagination metadata
---

# Database

`createDb(config, schema)` opens a SQLite database through `better-sqlite3` and hands you a Drizzle instance on `db.drizzle`. Queries are Drizzle's; the module adds what Drizzle leaves to you: running migrations, seeding, test-data factories, pagination metadata and closing the connection.

## Import

```ts
import { createDb } from '@loewen-digital/fullstack/db'
```

## Schema and queries

Define the schema with Drizzle's `sqlite-core` and pass it as the second argument; `db.drizzle` is then typed for it, including the relational `query` API.

```ts
import { createDb } from '@loewen-digital/fullstack/db'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { eq } from 'drizzle-orm'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const db = createDb({ driver: 'sqlite', url: './app.db', migrations: './drizzle' }, { users })

export function findByEmail(email: string) {
  return db.drizzle.query.users.findFirst({ where: eq(users.email, email) })
}

export function activeUsers() {
  return db.drizzle.select().from(users).where(eq(users.active, true))
}
```

`url` is the file path, or `':memory:'` for a throwaway database. Files run in WAL mode.

## Migrations

`migrate()` runs the migrations Drizzle Kit generated into `config.migrations` (default `./drizzle`); `rollback()` forgets the last applied migration in Drizzle's journal (it does not undo the SQL); `migrationStatus()` lists what is applied. The [CLI](/tooling/cli) exposes the same three as `fullstack migrate`, `migrate:rollback` and `migrate:status`.

```ts
async function prepare() {
  await db.migrate() // or db.migrate('./other/folder')
  const status = await db.migrationStatus() // [{ name, applied: true, appliedAt }]
  return status.length
}
```

## Seeds

`seed(fn)` runs a function against the instance and wraps a failure in `Seed failed: ...`.

```ts
async function seedUsers() {
  await db.seed(async (db) => {
    await db.drizzle.insert(users).values([
      { email: 'alice@example.com', name: 'Alice', createdAt: new Date() },
      { email: 'bob@example.com', name: 'Bob', createdAt: new Date() },
    ])
  })
}
```

## Factories

`factory(definition)` binds a test-data factory to the instance: `make` builds an object, `create` builds and inserts it through your `insert`, `createMany(n)` repeats that.

```ts
const userFactory = db.factory<typeof users.$inferInsert>({
  build: (overrides) => ({
    email: `user-${crypto.randomUUID()}@example.com`,
    name: 'Alice',
    createdAt: new Date(),
    ...overrides,
  }),
  insert: async (db, user) => {
    await db.drizzle.insert(users).values(user)
    return user
  },
})

async function seedTestUsers() {
  const bob = await userFactory.create({ name: 'Bob' })
  const more = await userFactory.createMany(5)
  return [bob, ...more]
}
```

## Pagination

`paginate(data, total, { page, perPage })` computes the metadata for a page you fetched with `limit` and `offset`; it runs no query itself.

```ts
import { count } from 'drizzle-orm'
async function usersPage(page: number, perPage = 20) {
  const rows = await db.drizzle.select().from(users).limit(perPage).offset((page - 1) * perPage)
  const [row] = await db.drizzle.select({ total: count() }).from(users)
  return db.paginate(rows, row?.total ?? 0, { page, perPage }) // { data, total, page, perPage, lastPage }
}
```

`paginateHelper` is the same function without an instance.

## Closing

`close()` closes the SQLite handle; call it when a script or test is done.

## Drivers

| Driver | Status |
|---|---|
| `sqlite` | `better-sqlite3`, bundled with the package |
| `postgres`, `mysql`, `d1` | Declared in the config type; `createDb` throws for them. Use Drizzle's own driver for these databases directly |

## Config options

`createDb(config, schema?)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'sqlite'` | — | Only `sqlite` is implemented |
| `url` | `string` | — | File path, or `':memory:'` |
| `migrations` | `string` | `'./drizzle'` | Folder `migrate()` and the CLI read |
| `seeds` | `string` | — | Folder the CLI's `seed` command reads; `createDb` itself does not use it |
| `schema` (2nd argument) | Drizzle tables | `{}` | Types `db.drizzle` and enables `db.drizzle.query` |
