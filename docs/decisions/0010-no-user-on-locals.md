# 0010 · No `user` on locals: the adapters expose the session, the app loads the user

## Context

Every adapter set `user = { id: authSession.userId, email: '' }` once the auth cookie validated:
`AuthInstance` has no user lookup, so the object was invented, and its type `AuthUser` includes
`passwordHash`, one `return { user: locals.user }` away from the client. #9 offered two ways out: drop
`user`, or add `findUserById` to `AuthInstance` and load the user on every authenticated request.

## Decision

Drop it. The adapters expose `authSession`, whose `userId` is the key; the app loads the user where it
needs it, from its own store, as the quick start and the guide already do. No read per request the app
did not ask for, no hash near page data, and the adapter keeps its stance of having no user store.

## Consequences

`FullstackLocals`, `FullstackNuxtContext`, `FullstackAstroLocals` and `FullstackRemixArgs` lose `user`;
code that read it fails to compile and switches to `authSession.userId`. An eager, hash-free user object
stays possible later as an opt-in on `createAuth`, not as adapter behaviour.
