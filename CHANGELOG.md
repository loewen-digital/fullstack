# Changelog

All notable changes to fullstack, newest first. SemVer, 0.x is pre-release. The heading
format is a contract, keep it: `## v<Version> · <YYYY-MM-DD> · <Title>`. Lines under
`## Unreleased` move under the next version heading at release; the version in `package.json`
is the topmost released one here.

## Unreleased

- Node 24 is the required version (`engines.node` in `package.json`); CI, deploy and the agent workflow read it from there.
- Design for running `session` and `auth` on `@loewen-digital/flatdb` (Cloudflare R2 in production) is decided: the session driver writes one object per session through flatdb's `StorageAdapter`, the auth adapter is a reference `AuthDbAdapter` on the app's own collections, both ship as their own subpaths without importing flatdb. Decision: [ADR 0001](docs/adr/0001-flatdb-driver.md). (#1)
- Agent rules live in `AGENTS.md`; `CLAUDE.md` only imports it. The Codex review rules are a section of the same file.
- `TASKS.md` removed: every task in it was done. `PROMPTING.md`, the guide for building from that list, removed with it. Open work lives in GitHub issues.
