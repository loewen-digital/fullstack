# AGENTS.md — @loewen-digital/fullstack

Single instruction file for every coding agent working in this repository. Codex reads it directly; Claude Code reads it through `CLAUDE.md`, which only imports this file. Change rules here, never in `CLAUDE.md`.

## Project Overview

This is `@loewen-digital/fullstack` — a single npm package providing backend primitives (auth, DB, validation, mail, storage, queue, etc.) for any JavaScript meta-framework. It follows a "Laravel for JS" philosophy but implemented as a composable library, not a framework.

**Read SPEC.md for the complete design specification before making any architectural decisions.**

---

## Core Principles

1. **One package** — everything ships as `@loewen-digital/fullstack` with subpath exports
1. **Framework-agnostic core** — no module may import from SvelteKit, Nuxt, Remix, or any framework. Only adapters touch framework code.
1. **Factory functions, not DI** — every module exports a `createX(config)` function. No service providers, no dependency injection containers.
1. **Driver pattern** — every module with I/O has swappable backends via a driver interface
1. **Direct imports** — no virtual modules, no magic. Users import from subpaths like `@loewen-digital/fullstack/auth`
1. **Web Standards first** — use the Web Platform APIs everywhere: `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `FormData`, `ReadableStream`, `crypto.subtle`, etc. Never invent custom types when a Web Standard exists. This also ensures compatibility across runtimes (Node, Deno, Cloudflare Workers, Bun).
1. **TypeScript-first** — everything is fully typed. `createStack` return type is inferred from config.
1. **Tree-shakeable** — unused modules don't end up in the bundle

---

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** Vite (library mode, ESM only — never CJS)
- **Test:** Vitest
- **ORM:** Drizzle ORM
- **Package manager:** npm (never yarn or pnpm)
- **Node target:** Node 20+

---

## Project Structure

```
src/
├── index.ts              → defineConfig, createStack, re-exports
├── config/               → config loading, env helper, types
├── validation/           → stateless validate(), rules, custom rules
├── auth/                 → createAuth(), session, password, token, OAuth
├── db/                   → createDb(), migrations, seeds, factories, pagination
├── session/              → createSession(), flash, old input, drivers/
├── security/             → createSecurity(), CSRF, CORS, rate limit, sanitize
├── mail/                 → createMail(), templates, drivers/
├── storage/              → createStorage(), drivers/ (local, s3, r2, memory)
├── cache/                → createCache(), drivers/ (memory, redis, kv)
├── logging/              → createLogger(), transports/
├── errors/               → error classes, HTTP errors, handler
├── queue/                → createQueue(), job class, drivers/
├── events/               → createEventBus(), listeners
├── notifications/        → createNotifications(), channels/
├── i18n/                 → createI18n(), pluralization, formatting
├── search/               → createSearch(), drivers/ (sqlite-fts, meilisearch, typesense)
├── permissions/          → createPermissions(), roles, policies
├── webhooks/             → createWebhooks(), incoming/outgoing
├── realtime/             → createRealtime(), websocket, SSE
├── testing/              → createTestStack(), fakes, factories, DB helpers
├── adapters/
│   ├── sveltekit/        → createHandle(), type augmentation
│   ├── nuxt/
│   ├── remix/
│   └── astro/
├── vite/                 → Vite plugin, dev UI
└── cli/                  → CLI commands (migrate, seed, generate)
```

---

## Development Commands

```bash
npm install               # Install dependencies
npm run build             # Build with Vite (library mode, ESM only)
npm run dev               # Watch mode
npm run test              # Run vitest
npm run test:watch        # Run vitest in watch mode
npm run lint              # Lint with ESLint
npm run typecheck         # TypeScript type checking
```

---

## Coding Conventions

### Module Pattern

Every module with I/O follows this pattern:

```ts
// src/mail/index.ts
import type { MailConfig, MailInstance, MailMessage } from "./types.js";
import { resolveDriver } from "../config/drivers.js";

export function createMail(config: MailConfig): MailInstance {
  const driver = resolveDriver(config.driver, {
    console: () => import("./drivers/console.js"),
    smtp: () => import("./drivers/smtp.js"),
    resend: () => import("./drivers/resend.js"),
    postmark: () => import("./drivers/postmark.js"),
  });

  return {
    async send(message: MailMessage): Promise<void> {
      await driver.send(message);
    },
    // ...
  };
}
```

### Driver Interface Pattern

```ts
// src/storage/types.ts
export interface StorageDriver {
  get(key: string): Promise<ReadableStream | null>;
  put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    meta?: FileMeta,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  getUrl(key: string): Promise<string>;
}
```

### File Conventions

- One `index.ts` per module as the public entry point
- One `types.ts` per module for all type definitions
- Drivers live in a `drivers/` subdirectory
- All imports use `.js` extensions (for ESM compatibility)
- No default exports — always named exports
- No classes unless truly necessary — prefer plain objects and functions
- No `any` — use `unknown` and narrow

### Naming

- Factory functions: `createX()` (e.g., `createAuth`, `createMail`)
- Driver interfaces: `XDriver` (e.g., `StorageDriver`, `CacheDriver`)
- Config types: `XConfig` (e.g., `MailConfig`, `AuthConfig`)
- Instance types: `XInstance` (e.g., `MailInstance`, `AuthInstance`)
- Errors: `FullstackError`, `ValidationError`, `AuthenticationError`, etc.

### Testing Conventions

- Every module has a corresponding `__tests__/` directory
- Test files: `*.test.ts`
- Use Vitest's `describe`, `it`, `expect`
- Use in-memory drivers for all tests (no external dependencies)
- Each test should be independent (no shared state)
- Use the `createTestStack()` helper for integration tests

---

## Dependency Rules

### Core has ZERO framework dependencies

The `src/` directory (excluding `src/adapters/`) must never import from:

- `@sveltejs/kit`
- `nuxt`
- `@remix-run/*`
- `astro`
- Any other framework

### Module dependencies

Modules can depend on other modules ONLY as documented in the dependency graph (see SPEC.md). Key rules:

- `auth` depends on `db` (required)
- `session` optionally uses `cache`
- `notifications` depends on `mail`
- `validation` is fully standalone (no dependencies)
- `events` is fully standalone
- `testing` can mock any module

### External dependencies

Minimize external dependencies. Prefer:

- Node built-ins (`crypto`, `fs`, `path`) over npm packages
- Single-purpose packages over large utility libraries
- Optional peer dependencies for heavy drivers (e.g., `redis`, AWS SDK)

---

## Subpath Exports

Every module is accessible via a subpath export. The `package.json` `exports` field must be kept in sync with the module structure. See SPEC.md for the full exports map.

When adding a new module:

1. Create the directory under `src/`
1. Add `index.ts` and `types.ts`
1. Add the subpath export to `package.json`
1. Add to `src/index.ts` convenience re-exports if appropriate
1. Update SPEC.md

---

## Implementation Priority

Every module from SPEC.md is implemented; open work lives in GitHub issues. When a module is added, keep this order:

1. Foundation first (config, types, build setup)
1. Standalone modules next (validation, errors, logging)
1. Core modules (db, auth, session, security)
1. Infrastructure modules (mail, storage, cache, queue)
1. Higher-level modules (notifications, search, permissions, etc.)
1. Adapters (SvelteKit first)
1. Tooling (Vite plugin, CLI, Dev UI)

---

## Important Notes

- **No React** — ever. Not in code, not in examples, not in the dev UI.
- **No tsup, no CJS** — build with Vite library mode, ESM only.
- **Web Standards everywhere** — use `Request`, `Response`, `Headers`, `URL`, `FormData`, `ReadableStream`, `Uint8Array`, `crypto.subtle` instead of Node-specific APIs or custom abstractions. Avoid `Buffer` (use `Uint8Array`), avoid custom request types (use `Request`), avoid `node:http` patterns.
- **npm only** — no yarn, no pnpm.
- **SvelteKit is the primary adapter** — build and test with SvelteKit first, then add other adapters.
- Prefer **small, focused implementations** — get the API surface right first, then optimize.
- When in doubt, look at how **Laravel** solves the problem, then adapt it to TypeScript/functional style.
- The **Dev UI** is a SvelteKit app embedded via the Vite plugin.

## Agent Loop

Two ways to be here; check `GITHUB_ACTIONS`.

- **Set:** you run unattended via `.github/workflows/agent.yml` as `claude[bot]`. Nobody answers questions. Follow **Issue** and **Review** below: branch, PR, never `main`.
- **Not set:** you are in a local session with Eddy (Claude Code or Codex). Work on `main` and push after every green validation (the commands in step 4) while the version in `package.json` is below 1.0; a branch only when Eddy asks for one. **Always**, **Changelog** and **Writing for humans** apply to you as well. The loop is not your topic: do not look for `ready` issues, do not report whether the loop runs, do not mention labels or the cockpit unless Eddy asks. Work as if the loop did not exist.

**Issue** (label `ready`):

1. Read the issue: `gh issue view <n> --json title,body,labels,comments`. If acceptance criteria are missing: comment the concrete question, add label `needs-human`, remove `ready`, stop.
2. Branch `claude/issue-<n>-<slug>` from the default branch. One issue, one branch, one PR.
3. Implement following the rules above. Acceptance criteria are binding; a solution proposed in the issue is not. Build what fits this project and its conventions, even where that differs from the proposal, and explain every difference in the PR under "Deviations from the issue". If the need does not belong in this project: comment why, label `needs-human`, remove `ready`, stop. If something is missing in one of our own libraries (fullstack, flatdb, sveltekit-ai-orchestrator, element-js, element-js-ssr-renderer, element-library): open an issue there (`gh issue create --repo <owner/lib>`) that states the need and the context here, with at most a non-binding proposal; add the smallest workaround marked `// UPSTREAM: <issue-url>`, keep going. Never wait for upstream.
4. `npm run lint && npm run typecheck && npm test && npm run build` must pass. After three failed attempts: open a draft PR, label `needs-human`, stop.
5. Review your own diff: security, dead code, error handling, accessibility.
6. Open the PR (`gh pr create`) in the PR format below, with `Closes #<n>`. Do not post `@codex review`: Codex ignores comments from bots. Eddy requests the review.

**Review** (a review on a `claude/*` PR):

1. Read reviews and inline comments since the last commit (`gh pr view <n> --json reviews,comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`). Nothing to do: stop, no comment.
2. Fix every point or explain in the thread why not. Never dismiss a security finding.
3. Validation green, push, then one PR comment: `Review findings addressed in <short sha>.` The workflow requests the re-review. After three fix rounds on one PR: `needs-human`, stop.

**Always:**

- Size and safety: before implementing, judge the scope. If it needs more than one PR (several independent parts, more than ~15 files), create sub-issues with `gh issue create` (the first labelled `ready`, the rest unlabelled), attach each to the parent as a GitHub sub-issue, comment the list on the parent, and work only the first. Commit and push after the first meaningful step and keep pushing, so nothing is lost when the run hits its turn limit.
- Dependencies are GitHub relations, never prose. When an issue cannot be finished before another one is closed, set "blocked by"; when you split work, set sub-issues. Lines like "Blocked by: #3" or "depends on #6" in the text are not read by the cockpit. Ids via `gh issue view <n> --json id --jq .id` (add `--repo` for another repo), then:
  `gh api graphql -f query='mutation($a:ID!,$b:ID!){addBlockedBy(input:{issueId:$a,blockingIssueId:$b}){clientMutationId}}' -F a=<id of the waiting issue> -F b=<id of the blocker>`
  `gh api graphql -f query='mutation($a:ID!,$b:ID!){addSubIssue(input:{issueId:$a,subIssueId:$b}){clientMutationId}}' -F a=<id of the parent> -F b=<id of the sub-issue>`
  An upstream issue with a workaround in place is not a blocker; set "blocked by" only when the work truly cannot proceed.
- Memory of this repository: nothing survives a run except what is committed. Rules live in this file. Every change a user or a developer of this project would notice gets its lines in `CHANGELOG.md` (see **Changelog**), in the same commit. When you deviate from an issue or choose between options, write `docs/decisions/NNNN-<slug>.md` (next free number; `## Context`, `## Decision`, `## Consequences`; at most 20 lines) and link it from the changelog line. Do not keep status logs or decisions in this file.
- Never ask. Blocked means: comment the question with options, `needs-human`, stop.
- Conventional commits (`feat:`, `fix:`, `chore:`, ...). Never force-push. Never commit secrets.
- In the loop, Eddy merges, not the agent.
- In the loop, never create or modify files under `.github/workflows/`: the App token lacks the `workflows` scope and the push is rejected. Describe the needed workflow change in a `needs-human` issue instead and continue. Locally, Eddy's `gh` has the scope.

**Changelog** (`CHANGELOG.md`, newest first):

- `## Unreleased` on top, then one `## v<Version> · <YYYY-MM-DD> · <Title>` heading per release; the version in `package.json` is the topmost released one. The heading format is a contract: some apps show the file as release notes.
- Bullets are written for the people who use or build the project: what changed and why it matters, not which files moved. Keep the language the file already uses.
- A release moves the Unreleased lines under a new version heading and bumps `package.json`. The loop never releases; Eddy does. Where this file says otherwise for a repository (version bump per commit), that rule wins.

**Writing for humans** (issues, PRs, comments):

- Everything you write is read by one person who wants to decide in thirty seconds. Result first, decisions visible, details collapsed in `<details><summary>Details</summary>…</details>`. Never drop information; move it down.
- PR body, in this order, at most 15 lines outside `<details>`: one sentence on what changed and why; `## Deviations from the issue` (bullets, or "none"); `## Needs Eddy` (touched auth, payments, schema or secrets; new secrets; upstream issues filed; follow-ups; or "nothing"); `## Verified` (the commands that passed, one line). Design reasoning, what was tried and failed, and file-by-file notes go into `<details>` or the commit messages.
- Issues you create (sub-issues, upstream): at most 20 lines outside `<details>`: `## Goal` (one sentence), `## Context` (why, for whom, link to the source issue), `## Acceptance criteria` (checkboxes, behaviour only), `## Proposal (non-binding)` if you have one, `## Out of scope`.
- Comments: one sentence plus a sha or link. Reasoning, if needed, in `<details>`.
- Commit messages carry the detail: conventional subject, body says why.

## Review rules (Codex)

- Judge the PR against the linked issue's acceptance criteria and the rules in this file.
- Acceptance criteria are binding, the issue's proposed solution is not. A PR that copies the proposal where a solution matching this project's conventions would fit better is a finding. Deviations must be explained under "Deviations from the issue".
- Check the PR body against the diff: if `## Needs Eddy` omits a touched sensitive area, or a deviation from the issue is not listed, that is a finding.
- A change a user or developer would notice without lines under `## Unreleased` in `CHANGELOG.md` is a finding. A deviation listed in the PR without a file under `docs/decisions/` is a finding.
- Report security issues, correctness bugs, missing or tautological tests, and rule violations. Skip formatting and naming taste.
- Say explicitly if the PR touches auth, payments, schema, or secrets.
- Findings first, with file and line. No praise, no diff summary.
