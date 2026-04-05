---
title: Database
description: Drizzle ORM wrapper with migrations, seeds, pagination, and query helpers
---

# Database

The `db` module wraps [Drizzle ORM](https://orm.drizzle.team/) with a consistent factory API, adding migration management, seeders, model factories, and pagination helpers.

## Import

```ts
import { createDb } from '@loewen-digital/fullstack/db'
```

## Basic usage

```ts
import { createDb } from '@loewen-digital/fullstack/db'

const db = createDb({
  driver: 'sqlite',
  url: './app.db',
})

// db.query is the Drizzle query builder
const users = await db.query.users.findMany({
  where: (users, { eq }) => eq(users.active, true),
})
```

## Defining a schema

Define your schema with Drizzle and pass it to `createDb`:

```ts
import { createDb } from '@loewen-digital/fullstack/db'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

const db = createDb({
  driver: 'sqlite',
  url: './app.db',
  schema: { users },
})
```

## Migrations

```bash
# Generate a migration from your schema
npx fullstack migrate:generate

# Run pending migrations
npx fullstack migrate:run

# Roll back the last migration
npx fullstack migrate:rollback
```

## Pagination

```ts
const page = await db.paginate(
  db.query.users.findMany({ orderBy: (u, { desc }) => desc(u.createdAt) }),
  { page: 1, perPage: 20 }
)

// page.data        — array of results
// page.total       — total record count
// page.currentPage — current page number
// page.lastPage    — last page number
// page.hasMore     — whether more pages exist
```

## Driver options

| Driver | Description |
|---|---|
| `sqlite` | SQLite via `better-sqlite3` (great for development) |
| `postgres` | PostgreSQL via `postgres.js` |
| `mysql` | MySQL/MariaDB via `mysql2` |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'sqlite' \| 'postgres' \| 'mysql'` | — | Database driver |
| `url` | `string` | — | Connection URL or file path |
| `schema` | `Record<string, Table>` | `{}` | Drizzle schema tables |
| `migrations.dir` | `string` | `'./migrations'` | Directory for migration files |
| `pool.max` | `number` | `10` | Maximum connection pool size |
