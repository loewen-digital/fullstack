# 0040 · A sweep for what accounts leave behind

## Context

Decision 0002 keeps the auth stores bounded per user: a login removes that user's expired sessions, a
presented session or token is deleted, a new token replaces the earlier one. What belongs to accounts
that do not come back stays, and an app could only delete it from the adapter's collections itself (#49).

## Decision

`AuthDbAdapter` gets the optional `deleteExpired(now)`: every session and token that ended before
`now`, of all users, answered as `{ sessions, tokens }`. `auth.sweep()` calls it with the time of the
call; when it runs is the app's business. Against the proposal in the issue, `sweep()` throws on an
adapter without the method and does not answer zeros: zeros read as "nothing had expired", and a privacy
policy that rests on the sweep would be wrong unnoticed. `sessionExtendAfter` does the same.

## Consequences

An app that sweeps on an adapter of its own implements `deleteExpired`; every other adapter works as
before. On flatdb a sweep reads the index of both collections and deletes one file per expired document.
