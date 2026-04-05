---
title: Auth
description: Authentication with sessions, passwords, tokens, and OAuth
---

# Auth

The `auth` module handles the full authentication lifecycle: user lookup, password verification, session creation, remember-me tokens, and OAuth flows. It depends on the `db` module for user storage.

## Import

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'
```

## Basic usage

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'
import { db } from './db.js'

const auth = createAuth({
  db,
  session: {
    driver: 'cookie',
    secret: process.env.SESSION_SECRET!,
  },
  password: {
    algorithm: 'argon2id',
  },
})
```

## Logging in

```ts
// Attempt a login with email + password
const user = await auth.attempt({ email, password })

if (!user) {
  return { error: 'Invalid credentials' }
}

// Create a session (sets a cookie on the Response)
const response = await auth.login(user, { remember: true })
```

## Getting the current user

```ts
// Pass a Web Standard Request — works in any framework
const user = await auth.user(request)

if (!user) {
  // Not authenticated
}
```

## Logging out

```ts
const response = await auth.logout(request)
// Returns a Response that clears the session cookie
```

## Password hashing

```ts
const hash = await auth.password.hash('mysecretpassword')
const valid = await auth.password.verify('mysecretpassword', hash) // true
```

## Token-based auth

```ts
// Generate a signed token (for API keys, password reset, email verification)
const token = await auth.tokens.create({ userId: 1, type: 'password-reset', expiresIn: '1h' })

// Verify and decode a token
const payload = await auth.tokens.verify(token)
```

## OAuth

```ts
const auth = createAuth({
  db,
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
  oauth: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUri: 'https://example.com/auth/github/callback',
    },
  },
})

// Redirect to provider
const { url } = await auth.oauth.redirect('github')

// Handle callback
const user = await auth.oauth.callback('github', request)
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `db` | `DbInstance` | — | Database instance (required) |
| `session.driver` | `'cookie' \| 'memory' \| 'redis'` | `'cookie'` | Session storage driver |
| `session.secret` | `string` | — | Secret for cookie signing |
| `session.ttl` | `number` | `86400` | Session lifetime in seconds |
| `password.algorithm` | `'argon2id' \| 'bcrypt'` | `'argon2id'` | Password hashing algorithm |
| `oauth` | `Record<string, OAuthProviderConfig>` | `{}` | OAuth provider configurations |
