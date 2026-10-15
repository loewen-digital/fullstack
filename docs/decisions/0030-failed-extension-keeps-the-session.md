# 0030 · A failed session extension keeps the session, the error goes to onError

## Context

#40: with `sessionExtendAfter` (0028) `touchAuthSession` let the error of `updateSessionExpiry` through.
The session was found and valid, only the bookkeeping failed, and the request answered 500: in anspiel a
store hiccup at the daily extension turned a save upload into an error the player could not read.

## Decision

The write is caught. `touchSession` and `validateSession` answer the session as the store holds it, with
`extended: false`, so the adapters send no refresh cookie; the next validation tries the write again.
The error goes to `onError` of `AuthConfig`, `console.error` by default, the shape feedback and billing
already use. Not chosen: an `error` field on `TouchedAuthSession`, which `validateSession` could not
carry and every adapter would have to look at.

## Consequences

An app sees the failure only in its log or its `onError`. A store that stays down ends the session on
time, nothing is extended by guessing. A failed `deleteSession` of an expired session still fails the request.
