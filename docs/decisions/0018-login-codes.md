# 0018 · Login codes: HMAC under a secret, looked up by user, attempts counted first

## Context

#31 proposes to store a login code as the hash of `${userId}:${code}` and find it by that hash. Six digits
are a million values: the hash gives the code to anyone who reads the store and undoes 0011, since a reader
can request a code for any user. And a wrong code's hash finds no record to count the attempt on.

## Decision

The stored value is HMAC-SHA-256 over `${userId}:${code}` under `loginCodeSecret`; `sendLoginCode` and
`verifyLoginCode` throw without it, like CSRF tokens without their secret (0006). `AuthDbAdapter` gains
`findUserToken(userId, type)`, well-defined since 0014 keeps one token per user and type, and
`countTokenAttempt(id)`, which returns the new count so a SQL adapter can increment atomically. The attempt
is counted before the code is compared, the right code included; the last allowed attempt deletes the code.

## Consequences

Breaking for adapter implementers (0.x); an app needs one more secret. On flatdb the count is
read-modify-write: the limit is soft under concurrent guesses, the endpoint needs a rate limit (#33).
