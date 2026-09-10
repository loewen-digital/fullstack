# 0005 · Docs samples are extracted from the pages and type-checked by a test

## Context

#7 found three pages documenting an API that does not exist and asked that every sample compile, either
through a docs typecheck or by copying the samples into a test. Copies drift from the page the reader sees.

## Decision

`src/__tests__/docs.test.ts` reads the pages, writes every ```ts block into `node_modules/.cache/docs-samples`
and compiles each page with the TypeScript API against `src/` (paths for `@loewen-digital/fullstack/*`), with
SvelteKit's real types and stubs for `$lib`, `$env/dynamic/private` and `./$types`. A block whose first line is
`// <path>.ts` is a file; the other blocks of a page share one module, later blocks may use what earlier ones
declared, names already imported are dropped from later imports. A self-check asserts that a broken sample fails.

## Consequences

The pages are the samples; a wrong sample fails `npm test` and the pre-push hook. A new page joins by adding
its path to `PAGES`. Samples need real scope: fragments that use a value take it as a function parameter or
`declare` it. Rendering is untouched, the file header is an ordinary comment.
