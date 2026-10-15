# 0029 · ci.yml is the library shape of the org snippet

## Context

#41: every loop repo runs the CI of `snippets/ci.yml` in loewen-digital/agent-loop (FRAMEWORK.md, step 3),
so a run reads the same everywhere. Here `ci.yml` was its own: v4 actions behind `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`,
`npm install` (never deliberate, there since `27d79ec`), no `concurrency`, `paths-ignore`, `timeout-minutes`, no manual run.

## Decision

`ci.yml` is the snippet without the jobs `e2e` and `deploy`, the `tags` trigger and the Cloudflare `env`:
one job `verify` (`npm ci`, check, unit tests, build, 10 minutes) on a push to `main`, a pull request and
a manual run; `paths-ignore: ['docs/**', '**.md']`; `concurrency` per ref with the snippet's
`cancel-in-progress` expression kept verbatim, so the file stays diffable. The tag guard stays in `release.yml`.

## Consequences

A push to `main` shows one run, `verify`. A push under `docs/` runs `Docs` alone: its `paths` and the
`paths-ignore` here do not overlap. A push that touches only `docs/decisions/**` or a root `*.md` runs
nothing, intended. The v5 actions run on Node 24 without the env.
