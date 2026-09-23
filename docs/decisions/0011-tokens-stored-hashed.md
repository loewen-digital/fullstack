# 0011 · Session and one-time tokens are stored hashed, with no plain-text fallback

## Context

`createAuthSession` and `generateToken` persisted the raw random token and `findSession`/`findToken`
looked it up verbatim, so whoever could read the auth collections (a bucket listing, a backup, a log
line) could log in or reset a password (#27). The issue allowed two ways with rows written before the
change: keep them working, or call the change out as breaking.

## Decision

Store SHA-256 of the raw token, look up by the same hash, nothing else. No second lookup by the raw
value for old rows: that path would keep exactly the leak the change removes and cost a query on every
miss forever. SHA-256 without salt or pepper is enough for 32 random bytes. The hashing lives inside the
module, so an `AuthDbAdapter` needs no change and never sees a raw token; the sessions `createSession`
and `validateSession` return carry the raw token, so `destroySession(authSession.token)` and the cookie
work as before.

## Consequences

Breaking for stored data: sessions and pending one-time tokens from before this version stop validating,
users log in again and request new mails. `hashToken` is exported for code that has to find the row
behind a token. Peppering and rotation stay out of scope.
