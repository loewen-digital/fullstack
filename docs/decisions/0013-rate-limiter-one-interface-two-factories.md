# 0013 · Rate limiter: one interface, two factories, no store seam

## Context

#29 proposes a `RateLimitStore` seam, `hit(key, windowMs, max)`, with the memory counter and a Cloudflare
store behind it. The Rate Limiting binding takes no window and no max (its limit and its 10 or 60 s period
are wrangler config) and answers `success` only: no count, no reset time, no reset. A store that ignores
two of three arguments lets `createRateLimiter({ max: 5, store })` look honoured when it is not.

## Decision

The seam is the `RateLimiter` interface itself: `createRateLimiter({ windowMs, max })` stays the memory
counter, `createBindingRateLimiter({ binding })` is the binding, `createSecurity` picks by `binding`. `check`
and `reset` return promises on both; `remaining` and `resetAt` are optional and absent from the binding; `reset`
there does nothing (a key that stays counted is the restrictive side); `windowMs`/`max` next to `binding` are `never`.

## Consequences

Breaking for callers of the sync memory limiter (0.x): they await `check`, and `Retry-After` code guards
`resetAt`. A Durable Object limiter, should the binding's periods prove too coarse, is a third factory.
