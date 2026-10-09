---
title: CLI
description: fullstack migrate, migrate:rollback, migrate:status, seed and generate, driven by fullstack.config.ts
---

# CLI

The package installs a `fullstack` binary. It reads `fullstack.config.ts` from the current directory, needs its `db` section (and `drizzle-orm` plus `better-sqlite3` installed), and runs migrations, seeds and scaffolds against that database.

## Usage

```bash
npx fullstack <command>
```

`npx fullstack help` prints the list below.

## Commands

| Command | Does |
|---|---|
| `migrate` | Runs the pending migrations from `db.migrations` (default `./drizzle`) with Drizzle's migrator |
| `migrate:rollback` | Removes the last entry from Drizzle's migration journal. It does not undo the SQL; that is yours |
| `migrate:status` | Lists the applied migrations with their timestamps |
| `seed [file]` | Runs a seed file: the given path, or `database/seeds/index.ts` (a `.js` next to it wins) |
| `generate factory <name>` | Writes `database/factories/<name>.factory.ts` with a `defineFactory` scaffold |
| `generate seed <name>` | Writes `database/seeds/<name>.seed.ts` with a default-exported seed function |

`generate` refuses to overwrite an existing file.

## Migrations

`migrate` is `db.migrate()` from the [db module](/modules/db): it applies the SQL migrations and journal that `drizzle-kit generate` writes into `db.migrations`. The workflow is Drizzle Kit's:

```bash
npx drizzle-kit generate
npx fullstack migrate
npx fullstack migrate:status
```

There is no `generate migration`: a migration is what Drizzle Kit generates from the schema, and `drizzle-kit generate --custom` writes an empty SQL file for one you fill in by hand. `migrate` applies both.

## Seeds

A seed file exports a function that takes the `DbInstance`, as a default export or as `seed`; `generate seed` writes that shape. `seed` without an argument runs `database/seeds/index.ts`.

```ts
// database/seeds/index.ts
import type { DbInstance } from '@loewen-digital/fullstack/db'

export default async function seed(db: DbInstance): Promise<void> {
  await db.seed(async () => {
    // insert through db.drizzle, or call the seed files of this folder in order
  })
}
```

```bash
npx fullstack seed
npx fullstack seed database/seeds/users.seed.ts
```

The file is loaded with a dynamic `import`, so a `.ts` seed runs on Node 24's type stripping; a `.js` build next to it is preferred when present.

## Configuration

`loadConfig()` imports `fullstack.config.ts` (or `.js`) from the working directory; `db` is the only section the CLI reads.

```ts
// fullstack.config.ts
import { defineConfig } from '@loewen-digital/fullstack'

export default defineConfig({
  db: { driver: 'sqlite', url: './app.db', migrations: './drizzle' },
})
```

| Key | Used by | Description |
|---|---|---|
| `db.driver`, `db.url` | all commands | The database, `sqlite` only |
| `db.migrations` | `migrate`, `migrate:status` | Drizzle Kit's output folder, default `./drizzle` |
