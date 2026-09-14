# 0008 · better-sqlite3 is an optional peer, loaded through createRequire

## Context

`better-sqlite3` was a dependency: every `npm install @loewen-digital/fullstack` compiled a native
binding, also for apps on flatdb or Workers that never call `createDb`. The two users of it, `createDb`
and `createSqliteFtsDriver`, loaded it with a bare `require`, which the ESM build shipped as is; from the
built package both threw `require is not defined`; vitest runs the source and hid it. Whether the
Drizzle `db` module stays next to flatdb is open (#22).

## Decision

`better-sqlite3` moves to `peerDependencies` as optional, `@types/better-sqlite3` to devDependencies.
Both factories load it through `createRequire(import.meta.url)`, so the API stays synchronous, and throw
an error naming the package on `MODULE_NOT_FOUND`. `createTestStack` opens `db` on first access.
`npm run build` ends with `scripts/smoke-dist.mjs`, which imports every subpath of `dist/` under Node ESM.

## Consequences

Apps on `createDb` or `sqlite-fts` install `better-sqlite3` themselves; everyone else gets no native module. `drizzle-orm` stays a dependency until #22 decides. A regression in the built files fails the build.
