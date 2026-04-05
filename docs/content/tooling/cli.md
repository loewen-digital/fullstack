---
title: CLI
description: Command-line tools for database management, code generation, and more
---

# CLI

`@loewen-digital/fullstack` ships with a CLI for common development tasks: running migrations, seeding the database, generating code, and managing your stack.

## Usage

```bash
npx fullstack <command>
```

Or install globally:

```bash
npm install -g @loewen-digital/fullstack
fullstack <command>
```

## Database commands

### `migrate:generate`

Generate a new migration file from your Drizzle schema changes:

```bash
npx fullstack migrate:generate
# Creates: migrations/0001_add_posts_table.sql
```

### `migrate:run`

Apply all pending migrations:

```bash
npx fullstack migrate:run
```

### `migrate:rollback`

Roll back the most recently applied migration:

```bash
npx fullstack migrate:rollback
```

### `migrate:status`

Show the status of all migrations (applied / pending):

```bash
npx fullstack migrate:status
```

### `db:seed`

Run your seeder file to populate the database with development data:

```bash
npx fullstack db:seed
```

### `db:fresh`

Drop all tables, re-run migrations, and run seeders:

```bash
npx fullstack db:fresh
```

## Code generation

### `generate:factory`

Generate a model factory for a database table:

```bash
npx fullstack generate:factory users
# Creates: src/database/factories/userFactory.ts
```

### `generate:seeder`

Generate a seeder file:

```bash
npx fullstack generate:seeder UsersSeeder
# Creates: src/database/seeders/UsersSeeder.ts
```

## Configuration

The CLI reads your stack configuration from `fullstack.config.ts` (or `.js`) in your project root:

```ts
// fullstack.config.ts
import { defineConfig } from '@loewen-digital/fullstack'

export default defineConfig({
  db: {
    driver: 'sqlite',
    url: './app.db',
    migrations: { dir: './migrations' },
  },
})
```
