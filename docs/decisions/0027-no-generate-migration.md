# 0027 · The CLI scaffolds no migration: Drizzle Kit owns them

## Context

#21: `fullstack generate migration <name>` wrote `drizzle/migrations/<timestamp>_<name>.ts` with empty
`up` and `down` functions. `fullstack migrate` is Drizzle's migrator; it applies the SQL files and the
journal `drizzle-kit generate` writes into `db.migrations` and never read that file. `migrate:rollback`
forgets the last journal entry and runs no `down`. The issue allows making the scaffold run or removing it.

## Decision

`generate migration` is removed; typing it prints where migrations come from. Not built: a wrapper around
`drizzle-kit generate --custom` (saves one `npx` call, ties the CLI to Drizzle Kit's flags and config) and
a runner for TypeScript `up`/`down` files (a second journal next to Drizzle's, for a need no app has;
`db` is the opt-in SQL module since 0009).

## Consequences

One way to a migration: `npx drizzle-kit generate` (`--custom` for hand-written SQL), then `fullstack
migrate`. `migrate:rollback` still only forgets the journal entry. `generate factory` and `seed` stay.
