# 0009 · flatdb is the store, `db` is opt-in Drizzle for SQL apps

## Context

#22 asked what becomes of `db` now that the package's own apps keep their data in flatdb. `db` is
Drizzle through and through: migrations are Drizzle's journal, `seed`/`factory` insert through Drizzle,
`paginate` wraps a Drizzle query, the test helpers are SQLite savepoints, the CLI calls all of it. flatdb
needs none of that: zod schemas, `find(filter, { sort, limit, skip })` plus `count` for pages, a
per-collection `migrate(doc)` hook. A `createDb({ driver: 'flatdb' })` would wrap `flatdb(adapter, collections)` and add little; the adapter comes from the app, not from string config (#16).

## Decision

`db` stays as it is, for apps on a SQL database, Node-only, and is never a default: `createTestStack`
builds `db` only with a `db` config, `drizzle-orm` is an optional peer like `better-sqlite3`, and the docs
say that apps on flatdb call flatdb directly, as the quick start does. Page metadata for collections is
flatdb's to add (loewen-digital/flatdb#8), not a wrapper's.

## Consequences

The package has no dependencies of its own. SQL apps install `drizzle-orm` and `better-sqlite3`, test stacks for flatdb apps need neither. SPEC.md keeps describing `db` as the SQL module.
