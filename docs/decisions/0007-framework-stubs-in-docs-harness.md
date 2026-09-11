# 0007 · Framework stubs in the docs harness

## Context

The Nuxt, Remix and Astro adapter pages import `h3`, `@remix-run/node`, `astro` and `astro:middleware`.
#11 left it open whether the docs test resolves them through devDependencies, as `@sveltejs/kit` is for
the SvelteKit page (#8), or through stubs. Astro alone is hundreds of packages; h3 and Remix are smaller
but would only prove the type mirrors, which is #8's kind of work, not a docs fix.

## Decision

`docs-harness.ts` stubs the slice of each framework the samples touch, modelled on the frameworks'
public types: h3's event on `node:http`, Astro's `APIContext` with `App.Locals` and `AstroCookies`,
Remix's loader and action args. Where a stub exposed a mirror that a real framework would reject,
the mirror was loosened (`getHeader` may return a number, Astro `locals` is `object`).

## Consequences

The samples prove the adapter API and the documented flow, not that the frameworks accept the adapters;
the stubs can drift. An issue tracks checking the three mirrors against the real packages as #8 did.
