---
title: Remix Adapter
description: Integrate @loewen-digital/fullstack into a Remix application
---

# Remix Adapter

The Remix adapter provides helper functions for using `@loewen-digital/fullstack` in Remix loaders and actions. Because Remix already uses Web Standard `Request` and `Response` objects, integration is straightforward.

## Import

```ts
import { getUser, requireUser } from '@loewen-digital/fullstack/adapters/remix'
```

## Setup

### 1. Create your stack

```ts
// app/lib/stack.server.ts
import { createDb } from '@loewen-digital/fullstack/db'
import { createAuth } from '@loewen-digital/fullstack/auth'

export const db = createDb({ driver: 'sqlite', url: './app.db' })

export const auth = createAuth({
  db,
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
})
```

### 2. Create adapter helpers

```ts
// app/lib/auth.server.ts
import { getUser, requireUser } from '@loewen-digital/fullstack/adapters/remix'
import { auth } from './stack.server.js'

export const getCurrentUser = getUser(auth)
export const requireAuth = requireUser(auth, '/login')
```

## Using in loaders

```ts
// app/routes/dashboard.tsx
import { json, type LoaderFunctionArgs } from '@remix-run/node'
import { requireAuth } from '~/lib/auth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireAuth(request)
  // Redirects to /login if not authenticated
  return json({ user })
}
```

## Login action

```ts
// app/routes/login.tsx
import { json, redirect, type ActionFunctionArgs } from '@remix-run/node'
import { validate } from '@loewen-digital/fullstack/validation'
import { auth } from '~/lib/stack.server'

export async function action({ request }: ActionFunctionArgs) {
  const data = Object.fromEntries(await request.formData())

  const result = validate(data, {
    email: ['required', 'email'],
    password: ['required'],
  })

  if (!result.passes) {
    return json({ errors: result.errors }, { status: 422 })
  }

  const user = await auth.attempt(result.data)

  if (!user) {
    return json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const response = redirect('/dashboard')
  await auth.login(user, response)
  return response
}
```

## Logout action

```ts
export async function action({ request }: ActionFunctionArgs) {
  return auth.logout(request)
  // Returns a redirect Response that clears the session
}
```

## Notes

- Remix already uses `Request` and `Response` — no conversion layer is needed
- The adapter helpers are thin wrappers that call `auth.user(request)` under the hood
- All `@loewen-digital/fullstack` modules work directly with Remix's native `Request` objects
