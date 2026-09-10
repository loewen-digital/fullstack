# 0001 · flatdb as storage for session and auth

- Status: accepted; amended 2026-09-10 (Decision 1 designed, not built; see Follow-ups)
- Date: 2026-09-08
- Issue: #1. Follow-ups: #3 (auth adapter), #4 (guide); #2 (session driver) parked

## Context

Apps built from `sveltekit-ai-starter-template` will keep their data in `@loewen-digital/flatdb` (JSON documents; `FsAdapter` locally, `R2Adapter` on Cloudflare Workers) instead of Drizzle/D1. They still want fullstack's `session` module (flash, old input) and `auth` module (passwords, sessions, one-time tokens), so both need a first-class flatdb backend.

What flatdb offers (0.1.0, npm release in progress):

- `StorageAdapter`: `read`, `write`, `delete`, `exists`, `list`, `mkdir`, `move` on string paths, plus optional `readVersioned`/`writeIf` for compare-and-swap. Implemented by `FsAdapter`, `MemoryAdapter`, `IndexedDBAdapter` and `R2Adapter` (loewen-digital/flatdb#1, done).
- `Collection` (auto ids) and `PathCollection` (path ids) on top of an adapter. Every collection keeps `<name>/_index.json` holding **all documents of the collection**. Reads (`findById`, `get`, `find`) are served from that index; every write rewrites the whole index, on R2 with a compare-and-swap on the etag, five retries, then it throws (loewen-digital/flatdb#3).
- On Workers: one `flatdb()` per request because the index is cached in memory; `nodejs_compat` is required.

The two workloads differ:

| | `session` module (server-side session data) | `auth` users, sessions, tokens |
|---|---|---|
| writes | on nearly every request (`save()`, flash rotation) | login, logout, verification, reset |
| reads | one document by id per request | by id, by email, by token |
| growth | with traffic, bounded by TTL | users slowly; sessions and tokens bounded by TTL |

## Decision

### 1. Session: a `SessionDriver` on the flatdb `StorageAdapter`, not on a collection

`createFlatdbDriver(adapter, options?: { ttl?: number; prefix?: string })` in `src/session/drivers/flatdb.ts` stores one object per session at `<prefix>/<sessionId>.json` (default prefix `sessions`) with the shape `{ data, expiresAt }`, `expiresAt` in epoch milliseconds. It uses only `adapter.read`, `write`, `delete` and `list`.

- `generateId()`: `crypto.randomUUID()`, as in the memory and redis drivers.
- `read(id)`: missing or expired returns `{}`; an expired object is deleted on the way (lazy expiry, one extra `delete`).
- `write(id, data, ttl?)`: `expiresAt = now + (ttl ?? options.ttl)`. The write is unconditional, so two overlapping requests of one visitor end last-writer-wins for that session, the same guarantee the redis and memory drivers give.
- `pruneExpiredSessions(adapter, options?)`: `list(prefix)`, read each object, delete the expired ones. A scan, exported next to the driver, never called by it. Apps run it from a Cloudflare Cron Trigger or the `queue` module.

Why not a `PathCollection`: a collection rewrites `sessions/_index.json`, which contains every live session's data, on every request, and retries the compare-and-swap whenever two requests of one visitor overlap (parallel fetches from one page). Every read would load the full index. The index buys a cheap `find({ expiresAt: { $lt: now } })` for pruning, and pruning is the rare operation; the per-request cost is the one that has to be small. The scan costs one `list` plus one `read` per live session and runs from a scheduled job, where that is acceptable.

`createSession({ driver: 'flatdb' })` throws the same guidance the redis branch throws ("import `createFlatdbDriver` from `@loewen-digital/fullstack/session/flatdb` and pass your adapter"). The adapter comes from the app, on Workers from `platform.env`, so string config cannot build it.

**Amendment 2026-09-10: designed, not built.** The login state does not live in the `session` module. `createAuth` keeps its sessions through `AuthDbAdapter` in the app's collections (Decision 2), server-side and revocable. What the `session` module carries in the starter is flash messages and old input, and the existing cookie driver covers that: no storage, no latency, no prune, and no dependency on flatdb's adapter contract, which is public as a type but nowhere documented as a store to use directly. The design above stays valid. #2 is parked until an app needs server-side session state on flatdb; #4 documents auth on flatdb next to `session: { driver: 'cookie' }` and states the cookie driver's limits (about 4 KB, signed but not encrypted, no secrets in it).

### 2. Auth: keep `AuthDbAdapter`, ship a reference implementation on flatdb collections

`AuthDbAdapter` in `src/auth/types.ts` is already a repository interface: eleven functions, no Drizzle type in any signature. It stays the seam. `createAuth` and the rest of `src/auth` do not change; the comments that say "implement against your Drizzle schema" are corrected.

`createFlatdbAuthAdapter({ users, sessions, tokens })` in `src/auth/adapters/flatdb.ts` takes three collections in **auto mode** and returns an `AuthDbAdapter`:

- `users` is the app's own users collection. Documents need `email`, optionally `passwordHash` and `emailVerifiedAt`; with a zod schema and the default `unknownFields: 'strip'` the schema must declare them. `findUserByEmail` is `findOne({ email })`, `findUserById` is `findById(id)`; flatdb's `_id` is exposed as `id`.
- `sessions`: `createSession` is `insert`, `findSession(token)` is `findOne({ token })`, `deleteSession(token)` is `delete({ token })`, `deleteExpiredSessions(userId)` is `delete({ userId, expiresAt: { $lt: now } })`.
- `tokens`: `createToken` is `insert`, `findToken(token, type)` is `findOne({ token, type })`, `markTokenUsed(id)` is `update({ _id: id }, { usedAt })`.
- Dates are stored as ISO 8601 strings (JSON has no `Date`; ISO strings order correctly under flatdb's plain `<` comparison) and turned back into `Date` on the way out.

Why collections here and not the raw adapter: auth looks records up by email, by token and by user id, which is what the index is for; these collections are small and written rarely, so the index cost fits them. Why auto mode and not path mode keyed by id: the users collection belongs to the app, and in every flatdb app it is an auto-mode collection with a zod schema. The adapter takes what the app already has instead of dictating a layout; sessions and tokens follow the same mode so the guide has one story.

No new `store` or `document` module: flatdb is the document store. A fullstack wrapper would be an interface with a single implementation and nothing behind it. The driver pattern applies where fullstack owns the interface, `SessionDriver` and `AuthDbAdapter`, and those are exactly the two seams used here. The `db` module stays Drizzle.

### 3. Packaging: structural types, optional peer dependency, own subpaths

- Neither file imports `@loewen-digital/flatdb`. Like `createRedisDriver` with its `RedisClient`, each declares the slice it needs as a local interface: `FlatdbStorage` (`read`, `write`, `delete`, `list`) and `FlatdbCollection<T>` (`findById`, `findOne`, `find`, `insert`, `update`, `delete`). Any flatdb adapter or collection satisfies them structurally, and the emitted `.d.ts` files stand on their own.
- `@loewen-digital/flatdb` is declared as an optional peer dependency (`peerDependencies` plus `peerDependenciesMeta.optional`), so the version contract is visible to consumers without forcing an install.
- Subpath exports `./session/flatdb` to `dist/session/drivers/flatdb.js` and `./auth/flatdb` to `dist/auth/adapters/flatdb.js`, with matching Vite entries and lines in `SPEC.md`. `src/session/index.ts` and `src/auth/index.ts` never import these files, so `@loewen-digital/fullstack/session` and `/auth` stay flatdb-free and `sideEffects: false` keeps everything else tree-shakeable.
- Tests run against flatdb's real `MemoryAdapter` and collections: a structural contract is worth testing against the real implementation. flatdb is being published to npm and becomes a devDependency from there; #3 adds it.

### 4. Runtime: Workers-safe by construction

- Both files use only the passed objects' Promise APIs, `crypto.randomUUID()`, `JSON` and `Date`. No `node:*` import, no `Buffer`, no filesystem.
- On Workers the app builds the adapter and the collections per request from `platform.env` (flatdb's rule: one database per request) and calls `createSessionManager(createFlatdbDriver(adapter))` and `createAuth(config, { db: createFlatdbAuthAdapter({ ... }) })` in the same place. Both factories hold no state and cost nothing to create.
- `src/auth/password.ts`, `token.ts` and `session.ts` import `node:crypto` (`scrypt`, `randomBytes`, `timingSafeEqual`). Cloudflare documents `node:crypto` as fully supported under `nodejs_compat` apart from a few key-generation cases, and flatdb requires that flag anyway, so this works today. Moving token generation to `crypto.getRandomValues` and revisiting scrypt (Web Crypto offers PBKDF2 only) is a separate issue under the Web Standards principle, not part of this work.
- Writes to one document are last-writer-wins in flatdb and in this driver, which matches the redis and memory drivers.

## Consequences

- One new entry point now (`./auth/flatdb`), a second (`./session/flatdb`) if #2 is ever built; no existing module changes its public API.
- #2 and #3 as filed assume path-mode collections and an index-based prune. Their acceptance criteria are rewritten to this decision: adapter-based session driver with a scanning prune, auto-mode collections for auth. #2 is then parked by the amendment.
- If #2 is built: session data lives as readable JSON objects, one per session, in the same bucket or folder as the app's data, and the prefix must not collide with a collection name.
- If #2 is built: expired session-module sessions are removed lazily on read and by `pruneExpiredSessions`; without the scheduled prune, abandoned sessions stay in storage.
- `AuthDbAdapter.deleteExpiredSessions` is declared but `src/auth` never calls it; #3 decides whether `createSession` calls it on login.

## Alternatives considered

- **Session driver on a `PathCollection`**, the shape #2 proposed: rejected for the per-request index rewrite, see Decision 1.
- **Cloudflare KV as the session store**: native TTL, but neither flatdb nor local-first. A possible separate driver later.
- **Cookie driver for the session module**: chosen for the starter by the amendment; it already covers flash and old input. The flatdb driver stays the answer for server-side session state.
- **A generic `store` module wrapping flatdb collections**: rejected, see Decision 2.
- **`import type` from flatdb instead of structural interfaces**: couples the emitted types to an optional package; the redis driver already shows the structural route.

## Follow-ups

- #2 session driver on flatdb: parked, closed as not planned; reopen when an app needs server-side session state on flatdb
- #3 reference `AuthDbAdapter` on flatdb
- #4 guide: auth on flatdb, `session` module on the cookie driver
