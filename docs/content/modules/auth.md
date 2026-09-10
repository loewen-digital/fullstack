---
title: Auth
description: Passwords, server-side sessions, one-time tokens and OAuth on any storage
---

# Auth

The `auth` module covers the authentication lifecycle: password hashing and verification, server-side sessions with opaque tokens, one-time tokens for email verification and password reset, and OAuth providers. It holds no state and knows no framework: storage is an `AuthDbAdapter`, and the cookie that carries a session token belongs to the framework adapter or to your code.

Storage is an `AuthDbAdapter`: implement it against your schema, or run on `@loewen-digital/flatdb` with `createFlatdbAuthAdapter` from `@loewen-digital/fullstack/auth/flatdb`. The [Auth on flatdb](/guides/auth-on-flatdb) guide covers that setup locally and on Cloudflare Workers, with the `session` module on the cookie driver and the [SvelteKit adapter](/adapters/sveltekit).

## Import

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'
```

## Setup

`createAuth(config, { db })` takes the lifetimes and the adapter. Every option has a default; the adapter is required.

```ts
import { createAuth, type AuthDbAdapter, type AuthUser } from '@loewen-digital/fullstack/auth'

declare const db: AuthDbAdapter // yours, or createFlatdbAuthAdapter(...) from the guide

const auth = createAuth({ sessionTtl: 7 * 24 * 3600 }, { db })
```

## Passwords and login

Registration is yours: hash the password and store the user with its `passwordHash` where the adapter's `findUserByEmail` finds it again. Login verifies the hash and opens a session. The session's `token` is opaque; it goes into an `httpOnly` cookie (`setAuthCookie` in SvelteKit) and is the only thing the browser holds.

```ts
async function register(email: string, password: string) {
  const passwordHash = await auth.hashPassword(password)
  // store { email, passwordHash } in your users table or collection
  return { email, passwordHash }
}

async function login(email: string, password: string) {
  const user = await db.findUserByEmail(email)
  if (!user?.passwordHash || !(await auth.verifyPassword(password, user.passwordHash))) {
    return null
  }
  return auth.createSession(user) // { id, userId, token, expiresAt, createdAt }
}
```

Hashing is scrypt through `node:crypto`; the parameters travel in the hash. `createSession` deletes the user's expired sessions before it inserts the new one ([decision 0002](https://github.com/loewen-digital/fullstack/blob/main/docs/decisions/0002-expired-sessions-on-login.md)), so the store stays bounded without a scheduled job.

## The current user

`validateSession(token)` returns the `AuthSession` behind a token, or `null` when the token is unknown or expired; an expired session is deleted on the way. The session carries the user id, the user record is one adapter call away.

```ts
async function currentUser(token: string | undefined) {
  const session = token ? await auth.validateSession(token) : null
  return session ? db.findUserById(session.userId) : null
}
```

## Logout

```ts
async function logout(token: string) {
  await auth.destroySession(token) // then clear the cookie
}
```

## Email verification and password reset

Both mint a one-time token, hand it to your send function together with the address, and consume it later. A token works once and expires after `emailVerificationTtl` or `passwordResetTtl`.

```ts
async function sendMail(to: string, subject: string, text: string) {
  // mail.send({ to, subject, text }) from @loewen-digital/fullstack/mail, or any transport
}

async function startVerification(user: AuthUser) {
  await auth.sendVerificationEmail(user, (email, token) =>
    sendMail(email, 'Verify your email', `https://example.com/verify?token=${token}`),
  )
}

async function finishVerification(token: string) {
  const user = await auth.verifyEmail(token) // AuthUser | null; marks the email verified
  return user !== null
}

async function startReset(user: AuthUser) {
  await auth.sendPasswordResetEmail(user, (email, token) =>
    sendMail(email, 'Reset your password', `https://example.com/reset?token=${token}`),
  )
}

async function finishReset(token: string, newPassword: string) {
  return auth.resetPassword(token, newPassword) // false when the token is unknown, used or expired
}
```

## Other one-time tokens

The same mechanism is open for your own flows (invitations, magic links). `verifyToken` returns the user id and consumes the token.

```ts
async function invite(user: AuthUser) {
  return auth.generateToken(user.id, 'invite', 3600) // type + TTL in seconds
}

async function acceptInvite(token: string) {
  return auth.verifyToken(token, 'invite') // string | number | null
}
```

## OAuth

`oauthProvider(name, config)` builds a provider; `google` and `github` are built in. Redirect the browser to `getAuthorizationUrl(state)`, keep `state` in the session, and on the callback hand `code` and the returned state to `handleCallback`. It returns the provider's tokens and a normalized user; finding or creating your own user and calling `createSession` is yours.

```ts
const github = auth.oauthProvider('github', {
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  redirectUri: 'https://example.com/auth/github/callback',
})

function startGithubLogin() {
  const state = crypto.randomUUID() // store it in the session, compare it on return
  return { state, url: github.getAuthorizationUrl(state) }
}

async function finishGithubLogin(code: string, state: string) {
  const { tokens, user } = await github.handleCallback(code, state)
  // user: { id, email?, name?, avatarUrl?, raw }; find or create your user, then auth.createSession(...)
  return { tokens, user }
}
```

## Config options

`createAuth(config, deps)` reads these; all lifetimes are seconds.

| Option | Type | Default | Description |
|---|---|---|---|
| `sessionTtl` | `number` | `604800` | Lifetime of a session (7 days) |
| `emailVerificationTtl` | `number` | `86400` | Lifetime of an email verification token (24 hours) |
| `passwordResetTtl` | `number` | `3600` | Lifetime of a password reset token (1 hour) |

| Dependency | Type | Description |
|---|---|---|
| `db` | `AuthDbAdapter` | Storage for users, sessions and tokens (required) |

## The adapter

`AuthDbAdapter` is the whole storage contract. `AuthUser` needs `id`, `email`, `passwordHash` and `emailVerifiedAt`; everything else on your user record is invisible to `auth`.

| Method | Purpose |
|---|---|
| `findUserByEmail(email)`, `findUserById(id)` | Users, `null` when absent |
| `createSession(data)`, `findSession(token)`, `deleteSession(token)`, `deleteExpiredSessions(userId)` | Sessions |
| `createToken(data)`, `findToken(token, type)`, `markTokenUsed(id)` | One-time tokens |
| `updateUserPassword(id, passwordHash)`, `markEmailVerified(id)` | Writes to the user |

`@loewen-digital/fullstack/auth/flatdb` ships `createFlatdbAuthAdapter({ users, sessions, tokens })` for flatdb collections; the [guide](/guides/auth-on-flatdb) has the schemas.
