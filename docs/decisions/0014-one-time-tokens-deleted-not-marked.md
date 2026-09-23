# 0014 · One-time tokens are deleted, not marked used

## Context

#26: `generateToken` inserted and never deleted, so every earlier verification or reset link of a user
stayed valid until its TTL, and a consumed token stayed as a record with `usedAt`. The issue allows
"delete, or mark used" for both the replaced and the consumed token.

## Decision

A token exists while it is valid. `generateToken` deletes the user's tokens of that type before it inserts
the new one; `verifyToken` deletes the record it finds, consumed or expired, before it answers.
`markTokenUsed` and `AuthToken.usedAt` are gone: one state fewer for adapters to store and for
`verifyToken` to check, and the tokens collection holds at most one live token per user and type.

## Consequences

Breaking for adapters, in the same release as 0011: `deleteToken(id)` and `deleteTokens(userId, type)`
replace `markTokenUsed(id)`. No audit trail of consumed tokens; an app that wants one logs the event.
Expired tokens of users who never click stay until swept, as before (decision 0002 for sessions).
