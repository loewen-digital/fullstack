# 0015 · A password reset revokes the user's sessions itself

## Context

#25: `resetPassword` returned a boolean and never said whose password it changed, so an app could not
revoke that user's sessions after a reset. The issue allows two routes: `resetPassword` revokes, or the
adapter gains `deleteUserSessions` and the instance `destroyUserSessions`, and the app calls it.

## Decision

Both, with the revocation inside `resetPassword`, not opt-in. A reset is the recovery path after a takeover;
a reset that leaves the attacker's session alive is never what an app wants, and an app that forgets the
extra call ships that hole. `resetPassword` returns `AuthUser | null` like `verifyEmail`, so the browser
that reset the password gets a fresh session. `destroyUserSessions(userId)` is exposed as well: the adapter
method exists anyway, and "log out everywhere" needs it without a reset.

## Consequences

Breaking twice, in the same release as 0011 and 0014: the return type, and `deleteUserSessions(userId)` on
every adapter. The browser that reset the password is logged out too and gets the fresh session or the login page.
