# 0027 · The CLI scaffolds no migration: Drizzle Kit owns them

## Context

#21: `fullstack generate migration <name>` wrote `drizzle/migrations/<timestamp>_<name>.ts` with empty
`up` and `down` functions. `fullstack migrate` is Drizzle's migrator; it applies the SQL files and the
journal that `drizzle-kit generate` writes into `db.migrations` and never read that file.
`migrate:rollback` forgets the last journal entry and runs no `down`. The issue allows either making the
scaffold run or removing it.

## Decision

`generate migration` is removed. The CLI says where migrations come from when someone still types it.
Not built: a wrapper around `drizzle-kit generate --custom` (it saves one `npx` call and ties the CLI to
Drizzle Kit's flags and its `drizzle.config.ts`) and a runner for TypeScript `up`/`down` files (a second
journal next to Drizzle's, for a need no app has; `db` is the opt-in SQL module since 0009).

## Consequences

One way to a migration: `npx drizzle-kit generate`, with `--custom` for hand-written SQL, then
`fullstack migrate`. `migrate:rollback` keeps forgetting the journal entry only, as the docs say.
`generate factory` and `generate seed` stay. `AnyDrizzleDb` stays exported from `db`.
