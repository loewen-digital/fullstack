# 0002 · Login removes the user's expired auth sessions

## Context

`AuthDbAdapter.deleteExpiredSessions(userId)` existed in the interface but nothing in `src/auth` called it,
so every adapter had to implement a method with no caller, and expired sessions stayed in storage until an
app scheduled its own cleanup. ADR 0001 left the call site to #3.

## Decision

`createAuthSession` calls `db.deleteExpiredSessions(user.id)` before it inserts the new session. One
query per login, scoped to that user; no global sweep, no scheduled job required. Every adapter is
affected the same way, since the call is in the auth module, not in the flatdb adapter.

## Consequences

Sessions of users who never log in again stay until an app deletes them itself (for flatdb:
`sessions.delete({ expiresAt: { $lt: now } })` from a Cron Trigger; the guide in #4 shows it). An adapter
whose `deleteExpiredSessions` is slow slows down login by that much.
