# 0003 · The auth-on-flatdb guide wires the session cookie and the auth cookie by hand

## Context

#4 asks for `auth` on flatdb next to the `session` module on the cookie driver, without production code
changes. Type-checking the guide against a SvelteKit 2 project surfaced two adapter gaps: `createHandle`
keeps only a session id in its cookie and the cookie driver's data in memory, nothing calls the driver's
`serialize`/`parse` (#6); `createHandle`, `setAuthCookie` and `clearAuthCookie` reject SvelteKit's `RequestEvent` (#8).

## Decision

The guide uses neither. A ten-line helper, `loadCookieSession`, seeds the driver from `parse(cookie)` before `load()`
and writes `serialize(data)` back after `save()`; the hook validates the `fs_token` cookie with `auth.validateSession`,
login and logout set and delete it through SvelteKit's `cookies`. Both carry `// UPSTREAM`; after #6 and #8 the guide goes back to the adapter.

## Consequences

Flash and old input travel in a signed cookie, stateless, on every runtime; the samples compile against
`@sveltejs/kit` 2 with `strict: true`. Until #6, `driver: 'cookie'` through `createHandle` alone stays a memory
driver. `handle.destroy()` then `save()` rewrites the data with every driver; the guide never destroys the flash session.
