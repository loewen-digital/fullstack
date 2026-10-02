# 0019 · KV rate limiter: the window's end lives in the value

## Context

#33 proposes a counter in KV: the value is the count, the first write sets `expirationTtl`, every check
writes `count + 1` with the same TTL. Each write renews the key's expiry, so under a steady stream of hits
the window never ends. An absolute `expiration` does not help: KV refuses one less than 60 seconds ahead.

## Decision

The value is `{ count, resetAt }`. `resetAt` is set by the first hit of a window and decides when it is
over; `expirationTtl` (the time left, 60 s at the least) only clears the key away. A hit over the limit
writes nothing. `createKvRateLimiter` is a third factory next to memory and binding (0013); `createSecurity`
picks it by `kv`. An error from KV, the refused second write to a key within a second included, rejects
`check`: swallowing it would let hits through uncounted or hide an exhausted write quota.

## Consequences

`remaining` and `resetAt` are reported. A caller that wants a 429 instead of an error on a refused write
catches it. Exact counting needs another store (a Durable Object limiter would be its own factory).
