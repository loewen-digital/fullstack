# ADR 0001: flatdb as a driver for session storage and auth persistence

- **Status:** Accepted (spike — no implementation in this PR)
- **Date:** 2026-09-04
- **Issue:** [#1](https://github.com/loewen-digital/fullstack/issues/1)

## Context

`sveltekit-ai-starter-template` apps want to store data as JSON documents with
[`@loewen-digital/flatdb`](https://github.com/loewen-digital/flatdb) — on Cloudflare R2 in
production — instead of Drizzle/D1. For `@loewen-digital/fullstack` to power auth and sessions
for those apps, it needs a first-class flatdb path for two modules:

- **`session`** — currently ships `cookie`, `memory`, and `redis` drivers behind the
  `SessionDriver` interface (`src/session/types.ts`).
- **`auth`** — currently persists via `AuthDbAdapter` (`src/auth/types.ts`), documented as "implement
  it against your Drizzle schema," but the interface itself is a plain object of async functions with
  no Drizzle types anywhere in its signature.

flatdb's relevant API surface, confirmed against its README and `flatdb-api-design.md`:

```ts
// Two collection identity modes:
// - "auto": insert(doc) generates a nanoid filename; no control over the id.
// - "path": insert(path, doc) / get(path) / update(path, changes) / delete(path) — caller
//   controls the document's key directly, same mental model as a filesystem path.

interface StorageAdapter {
  read(path: string): Promise<string | null>
  write(path: string, data: string): Promise<void>
  delete(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(dir: string): Promise<string[]>
  mkdir(dir: string): Promise<void>
  move(from: string, to: string): Promise<void>
  watch?(dir: string, cb: (event: WatchEvent) => void): () => void
}
```

Each collection directory automatically maintains an `_index.json` (`{ docId: { indexedField:
value, ... } }`) that is updated on every write and is what `find()`/`count()` query against —
`find()` does not walk the directory. There is **no built-in TTL or expiry mechanism** in flatdb;
this was confirmed absent from both source docs.

flatdb ships `FsAdapter`, `IndexedDBAdapter`, and `MemoryAdapter` today. A Cloudflare adapter is
tracked upstream ([loewen-digital/flatdb#1](https://github.com/loewen-digital/flatdb/issues/1)) as
an `R2Adapter implements StorageAdapter`, using a structural `R2BucketLike` interface so flatdb
never depends on `@cloudflare/workers-types`. This ADR assumes that adapter lands before either
follow-up issue below ships to Workers.

## Decision

### 1. Session: `SessionDriver` on flatdb

Add `src/session/drivers/flatdb.ts` exporting:

```ts
export function createFlatdbDriver(
  collection: FlatdbPathCollection<SessionDocument>,
  options?: { ttl?: number },
): SessionDriver
```

**Collection mode: `path`, not `auto`.** `SessionDriver.generateId()` hands out an id
(`crypto.randomUUID()`) *before* any document exists, and `write(sessionId, data, ttl)` must land
at exactly that id. Auto mode's `insert()` picks its own nanoid and offers no "insert at this id"
call, so it cannot implement `write(sessionId, ...)` faithfully. Path mode's `insert(path, doc)` /
`get(path)` / `update(path, changes)` / `delete(path)` map onto `write` / `read` / `destroy`
one-to-one, with `sessionId` as the path.

**`sessionId` must be validated before it is used as a path.** `SessionManager.load(sessionId)`
(`src/session/index.ts`) accepts whatever the caller passes in, and every framework adapter reads
that value straight from the client's session cookie (`src/adapters/nuxt/index.ts`,
`src/adapters/remix/index.ts`, `src/adapters/sveltekit/index.ts` all do
`driver.read/write(getRequestCookie(...))` with no parsing in between). Handing that
client-controlled string to a filesystem-style `path` collection as-is would let a crafted cookie
value (separators, `..`, or a name matching `_index.json`) address documents outside the session
namespace or the collection's index file, depending on what the underlying `StorageAdapter` does
with it. Since `generateId()` only ever hands out `crypto.randomUUID()` values, `createFlatdbDriver`
must reject anything that doesn't match the UUID shape before calling `get`/`update`/`delete` —
treating a malformed id the same as a missing session (`read` returns `{}`, `destroy` is a no-op)
rather than passing it through to the adapter. This validation is the driver's responsibility, not
something callers or other drivers need to duplicate.

**Document shape:**

```ts
interface SessionDocument {
  data: SessionData
  expiresAt: number // epoch ms, indexed field
}
```

**Expiry — lazy check on read, indexed scan for cleanup (not `_index.json` used as a TTL
primitive, since it has none):**

- `read(sessionId)`: `get(path)`, then compare `expiresAt` to `Date.now()` in the driver — same
  lazy-expiry approach as `createMemoryDriver` (`src/session/drivers/memory.ts`). This is O(1), no
  scan, and matches what `SessionDriver.read` already contracts (return `{}` for
  missing/expired — see `createMemoryDriver`).
- `write(sessionId, data, ttl)`: `update(path, ...)` if the doc exists, else `insert(path, ...)`,
  storing `data` and the computed `expiresAt`.
- `destroy(sessionId)`: `delete(path)`.
- **Reaping stale files:** lazy expiry never deletes the underlying document for sessions nobody
  reads again, which matters more here than for the in-memory driver because these are real
  storage objects (R2 PUTs/DELETEs cost money and count toward operations). Export a companion
  `pruneExpiredSessions(collection)` function that runs `collection.find({ expiresAt: { $lt:
  Date.now() } })` — a query against the automatically-maintained `_index.json`, not a directory
  walk — followed by `delete()` for each match. This is opt-in, called from a cron/queue job the
  app wires up itself; the driver does not run background timers (flatdb's Workers runtime has no
  `setInterval` guarantees between requests, and unattended timers don't belong in a stateless
  factory function per the driver pattern).

**Configuration:** the app constructs the flatdb collection and passes it in, exactly like the
existing `redis` driver takes a pre-connected client (`createRedisDriver(client, options)`,
`src/session/drivers/redis.ts`) rather than a connection string. `createSession({ driver: 'flatdb'
})`'s string-driver switch (`src/session/index.ts`) throws the same "import
`createFlatdbDriver` and pass your collection" guidance it already throws for `'redis'`, so no
`flatdb` dependency is ever required by the default `createSession` code path.

### 2. Auth storage: implement `AuthDbAdapter`, no new module

`AuthDbAdapter` (`src/auth/types.ts`) is already a plain interface of async functions —
`findUserByEmail`, `createSession`, `findToken`, `updateUserPassword`, etc. — with zero Drizzle
types in its signature, and `createAuth(config, { db })` (`src/auth/index.ts`) never imports
`src/db` or touches Drizzle. The "depends on db (required)" edge in SPEC.md's module dependency
graph describes the *concept* of a persistence adapter, not a hard dependency on the Drizzle-backed
`createDb()`. **Auth already runs on flatdb with zero core changes** — an app (or this repo, as a
follow-up) just needs a reference implementation of `AuthDbAdapter` backed by flatdb collections
(`users`, `sessions`, `tokens`, each in `path` mode keyed by id, following the same pattern as the
session driver above).

We are **not** introducing a new `store`/`document` module. A generic document-store abstraction
would duplicate what flatdb's collection API already is, and the driver pattern in this repo is
"one interface per module, implemented per backend" (`StorageDriver`, `SessionDriver`,
`CacheDriver`) — not a cross-cutting persistence layer. `AuthDbAdapter` is that interface for auth;
flatdb is a backend for it, same as Drizzle is today. The follow-up work is an example adapter
(likely under `src/auth/adapters/flatdb.ts` or shipped as a template in
`sveltekit-ai-starter-template` itself — the follow-up issue below decides which), not a new
core interface.

### 3. Packaging

- `@loewen-digital/flatdb` becomes an **optional peer dependency**: `peerDependencies:
  { "@loewen-digital/flatdb": "^x" }` plus `peerDependenciesMeta: { "@loewen-digital/flatdb": {
  "optional": true } }` in `package.json`. This repo has no `peerDependencies` block yet (Drizzle
  and `better-sqlite3` are currently regular `dependencies`); this ADR does not touch that
  existing pattern, only establishes that flatdb-backed drivers use the peer-optional shape SPEC.md
  already prescribes for "heavy drivers."
- New subpath exports, added only when the follow-up driver files exist:
  `"./session/flatdb": { "import": "./dist/session/drivers/flatdb.js", "types":
  "./dist/session/drivers/flatdb.d.ts" }` (mirrors how `createRedisDriver` is re-exported from
  `./session` today, but flatdb gets its own subpath since it pulls in the optional peer — importing
  `./session` must never require `@loewen-digital/flatdb` to be installed).
- **Tree-shaking:** `src/session/drivers/flatdb.ts` imports flatdb types only via `import type`
  and the runtime `import` is confined to that one file. `src/session/index.ts` does **not**
  import or re-export `createFlatdbDriver` (unlike `createRedisDriver`, which is dependency-free
  to import). Consumers who never import `@loewen-digital/fullstack/session/flatdb` never pull
  flatdb into their bundle or their install, matching how `redis` (the npm package) is not a
  dependency of this repo today either. Same story for a future `src/auth/adapters/flatdb.ts`.

### 4. Runtime (Cloudflare Workers)

Neither the session driver nor an `AuthDbAdapter` implementation touches storage directly — they
only call methods on the flatdb collection object the app constructs and passes in. All
filesystem-vs-R2 concerns are already isolated inside flatdb's `StorageAdapter`
(`FsAdapter`/`R2Adapter`/`MemoryAdapter`), so `src/session/drivers/flatdb.ts` has no Node `fs`
usage and no `#imports`/environment branching — it is portable across Node, Workers, and tests by
construction, as long as the app wires up `flatdb(new R2Adapter({ bucket: env.MY_BUCKET }))` (or
`FsAdapter`/`MemoryAdapter` in dev/tests) before constructing the driver. This is blocked on
`R2Adapter` landing upstream ([loewen-digital/flatdb#1](https://github.com/loewen-digital/flatdb/issues/1));
until then the flatdb session driver can be built and tested against `MemoryAdapter`/`FsAdapter`
but isn't production-ready for Workers.

## Alignment with Core Principles (`CLAUDE.md`)

- **Factory functions, not DI** — `createFlatdbDriver(collection, options)` matches the existing
  `createRedisDriver(client, options)` shape exactly.
- **Driver pattern** — flatdb becomes another `SessionDriver` implementation; no changes to the
  `SessionDriver` interface itself.
- **Framework-agnostic core** — nothing here imports a meta-framework; flatdb itself is
  framework-agnostic (its Svelte/Vue/Solid/React integrations are separate subpaths this repo never
  touches).
- **Web Standards first** — no new custom types introduced; `SessionData` stays `Record<string,
  unknown>`, timestamps stay epoch `number`, same as the `memory` driver.
- **Tree-shakeable** — see Packaging above; importing `@loewen-digital/fullstack/session` (or
  `/auth`) never pulls in flatdb.

## Consequences

- Apps on flatdb get a session driver with the same semantics (lazy expiry, `write`/`read`/
  `destroy`) as `memory` and `redis`, plus an opt-in reaper for storage cleanup.
- Auth needs no core changes — only documentation and a reference `AuthDbAdapter` implementation.
- flatdb-backed drivers are fully optional: zero impact on bundle size, install size, or type
  surface for apps that stay on Drizzle/D1.
- Production readiness on Workers is gated on the upstream `R2Adapter` issue.

## Follow-up issues

- [ ] Session driver on flatdb (`src/session/drivers/flatdb.ts`, `./session/flatdb` subpath,
  `pruneExpiredSessions`) — [#2](https://github.com/loewen-digital/fullstack/issues/2)
- [ ] Auth user store on flatdb (reference `AuthDbAdapter` implementation, `path`-mode
  `users`/`sessions`/`tokens` collections) — [#3](https://github.com/loewen-digital/fullstack/issues/3)
- [ ] Documentation: flatdb driver usage guide, `sveltekit-ai-starter-template` wiring example —
  [#4](https://github.com/loewen-digital/fullstack/issues/4)
