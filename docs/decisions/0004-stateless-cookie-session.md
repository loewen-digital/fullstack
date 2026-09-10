# 0004 · The cookie session driver is stateless; adapters open and commit through the manager

## Context

#6: `createHandle` kept only a session id in its cookie and read the cookie driver's data from an in-memory
Map, so `driver: 'cookie'` behaved like the memory driver. The issue proposed optional `serialize`/`parse` on
the driver and a seed-then-read round trip inside `createHandle`. CSRF tokens are bound to the session id, so
the id has to survive the round trip too, and every adapter loads the session the same way, not only SvelteKit's.

## Decision

`SessionDriver` gets optional `serialize(id, data)` and `parse(value)`; the cookie driver implements them with a
signed `{ id, data, exp }` envelope and has no store (`read`/`write`/`destroy` do nothing). `SessionManager`
gets `open(cookie)` and `commit(handle)`: cookie value in, cookie value out, for every driver. All four adapters
use the pair instead of `load`/`save` plus an id compare, so none regresses to "always empty" on the cookie driver.
`handle.destroy()` also clears the data, or it would do nothing on a stateless driver. `createSession` refuses a
cookie driver without `secret`.

## Consequences

Flash and old input are stateless on every runtime; the id in the payload keeps CSRF working. `load`/`save` on the
cookie driver no longer round-trip, `open`/`commit` is the API. The payload expires after `maxAge`. Encryption and a
size guard stay out, as #6 says; the cookie is readable by the client.
