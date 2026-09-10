# Changelog

All notable changes to fullstack, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

- `@loewen-digital/fullstack/auth/flatdb`: `createFlatdbAuthAdapter({ users, sessions, tokens })` runs `createAuth` on the app's own `@loewen-digital/flatdb` collections (auto mode). flatdb's `_id` is the user id, dates are stored as ISO strings and come back as `Date`. flatdb is an optional peer dependency; the adapter imports nothing from it, so `@loewen-digital/fullstack/auth` stays as it was. (#3)
- Login removes the user's expired auth sessions: `createSession` calls `AuthDbAdapter.deleteExpiredSessions(userId)` before it inserts the new one, so the session store stays bounded without a scheduled job. Decision: [0002](docs/decisions/0002-expired-sessions-on-login.md). (#3)
- The `AuthDbAdapter` docs and the `createStack` error no longer say the adapter is written against a Drizzle schema; it is storage-agnostic.
- Releases run from tags: pushing `v<version>` runs lint, typecheck, tests and build, publishes to npm through trusted publishing (no token, provenance included) and creates the GitHub Release with this file's matching section as notes. The tag must equal the version in `package.json`. Replaces `publish.yml` (token-based) and `changelog.yml` with `cliff.toml` (notes generated from commit messages). Decision: [0001](docs/decisions/0001-release-on-tag.md).
- `repository`, `bugs`, `homepage` in `package.json`, so npm shows the source and can attest provenance.
- Node 24 is the required version (`engines.node` in `package.json`); CI, deploy and the agent workflow read it from there.
- Design for running `auth` on `@loewen-digital/flatdb` (Cloudflare R2 in production) is decided: a reference `AuthDbAdapter` on the app's own collections, shipped as its own subpath without importing flatdb. The `session` module stays on the cookie driver; a flatdb session driver (one object per session through flatdb's `StorageAdapter`) is designed but parked until an app needs server-side session state. Decision: [ADR 0001](docs/adr/0001-flatdb-driver.md). (#1, #2)
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.
- `TASKS.md` removed: every task in it was done. `PROMPTING.md`, the guide for building from that list, removed with it. Open work lives in GitHub issues.
