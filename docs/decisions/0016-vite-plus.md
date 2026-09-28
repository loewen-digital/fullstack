# 0016 · Vite+ is the toolchain, `vp pack` builds the library

## Context

Vite+ 1.0 (MIT, 2026-09) bundles Vite 8, Vitest 5, Oxlint, Oxfmt and tsdown behind one CLI (`vp`) and one config file. Eddy decided on 2026-09-28 to move every loop repo to Vite+ and drop the separate tools (loewen-digital/agent-loop, T-016). fullstack built with Vite library mode plus `tsc -p tsconfig.build.json` for declarations, linted with ESLint, type-checked with `tsc --noEmit` and had no formatter.

## Decision

- `vp pack` (tsdown) builds the 28 entries as ESM with bundled declarations, `platform: 'node'` with `fixedExtension: false` so the files keep `.js`/`.d.ts`, every package import external. `scripts/smoke-dist.mjs` still runs after it.
- `vp check` replaces `lint` and `typecheck` in the scripts, CI and the pre-push hook. Oxfmt keeps the code's style (single quotes, no semicolons) at width 100 and leaves Markdown, `docs/` and `examples/` alone.
- Oxlint runs its correctness category plus the recommended rules outside it. Three type-aware correctness rules are off: `no-redundant-type-constituents` (driver unions like `'smtp' | string` are deliberate), `no-base-to-string` (validation and OAuth stringify unknown input on purpose), `unbound-method` (mock references in tests).

## Consequences

- Same subpaths, runtime exports and type exports as 0.3.0; one `.d.ts` per subpath plus shared chunks; unminified JavaScript (192 kB instead of 126 kB raw, before the consumer's bundler).
- `scripts/bundle-size.mjs` measures entry files only; with more code in shared chunks its per-subpath numbers are no longer comparable with earlier runs.
