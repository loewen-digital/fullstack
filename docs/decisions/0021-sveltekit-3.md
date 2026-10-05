# 0021 · Docs and the type test target SvelteKit 3

## Context

SvelteKit 3.0 is `latest` since 2026-10-01; Eddy decided on 2026-10-05 to move every loop repo to it, fullstack first (loewen-digital/agent-loop, T-019). The adapter has no dependency on `@sveltejs/kit`: it mirrors the slice of `RequestEvent` and `Handle` it uses, and `kit-types.test.ts` checks that mirror against the installed Kit. One Kit version can be installed, so the test and the type-checked docs samples follow one major.

## Decision

- `@sveltejs/kit` 3 and TypeScript 6 (Kit 3's minimum) are the devDependencies. The adapter source is unchanged: Kit 3's `Handle`, `RequestEvent` and `sequence` accept it as Kit 2's did.
- The docs samples are written for SvelteKit 3: `Handle` comes from `@sveltejs/kit/hooks` (Kit 3 moved the hook types there), the alias is `#lib/….js` instead of `$lib/…`. The harness resolves `#lib` through a `package.json` `imports` map next to the samples, as a Kit 3 project does, and no longer sets `baseUrl`, which TypeScript 6 rejects.
- The SvelteKit adapter page names the two differences for SvelteKit 2 in one sentence instead of carrying two sets of samples.

## Consequences

- Nothing changes for consumers on either Kit major; no release is needed for this.
- The adapter is no longer type-checked against SvelteKit 2. It stays structural, so a drift would have to come from fullstack's own side.
- `$env/dynamic/private` in the samples is deprecated in Kit 3 (removal announced for Kit 4), and `platform.env` in the flatdb guide is gone in `adapter-cloudflare` 8 (`env` comes from `cloudflare:workers`). Both follow once the app template runs on Kit 3 and shows the pattern.
