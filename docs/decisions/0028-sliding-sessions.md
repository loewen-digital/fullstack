# 0028 · Sessions extend on validation, throttled by the expiry they already carry

## Context

#35: a session ended `sessionTtl` after the login however often it was used, and `AuthDbAdapter` could
not update one. The alternative, a bare `extendSession(token)`, leaves the write throttle in every app.

## Decision

Opt-in `sessionExtendAfter` (seconds). A validated session gets `now + sessionTtl` when that lies at
least `sessionExtendAfter` behind the stored expiry: a session expires one TTL after its last extension,
so the distance is the time since then and the store needs no extra field. `validateSession` extends;
`touchSession` also answers `extended`, so `AuthSession` stays what the store holds. `updateSessionExpiry`
on the adapter is optional (own adapters keep compiling); `createAuth` throws when the option is set
without it. The SvelteKit handle sets the auth cookie again, the fetch adapter hands back `refreshCookie`.

## Consequences

The renewed cookie lives as long as the session has left, whatever `maxAge` says. An expiry never moves
earlier. Two requests at once may both write, with the same result. A session in use has no maximum age
(out of scope in #35). Nuxt, Remix and Astro extend the store and do not send the cookie again yet.
