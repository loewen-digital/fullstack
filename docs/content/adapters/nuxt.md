---
title: Nuxt Adapter
description: Integrate @loewen-digital/fullstack into a Nuxt application
---

# Nuxt Adapter

The Nuxt adapter integrates `@loewen-digital/fullstack` into Nuxt's Nitro server via server middleware and composables, making the current user available in API routes and server-rendered pages.

## Import

```ts
import { defineFullstackMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
```

## Setup

### 1. Create your stack

```ts
// server/lib/stack.ts
import { createDb } from '@loewen-digital/fullstack/db'
import { createAuth } from '@loewen-digital/fullstack/auth'

export const db = createDb({ driver: 'sqlite', url: './app.db' })

export const auth = createAuth({
  db,
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
})
```

### 2. Register server middleware

```ts
// server/middleware/auth.ts
import { defineFullstackMiddleware } from '@loewen-digital/fullstack/adapters/nuxt'
import { auth } from '../lib/stack.js'

export default defineFullstackMiddleware({ auth })
```

This sets `event.context.user` on every incoming request.

## Using the current user in API routes

```ts
// server/api/profile.get.ts
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler((event) => {
  const user = event.context.user

  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  return { user }
})
```

## Login route

```ts
// server/api/login.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { validate } from '@loewen-digital/fullstack/validation'
import { auth } from '../lib/stack.js'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const result = validate(body, {
    email: ['required', 'email'],
    password: ['required'],
  })

  if (!result.passes) {
    throw createError({ statusCode: 422, data: result.errors })
  }

  const user = await auth.attempt(result.data)

  if (!user) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  await auth.login(user, event)
  return { user }
})
```

## TypeScript augmentation

```ts
// types/fullstack.d.ts
import type { User } from '@loewen-digital/fullstack/auth'

declare module 'h3' {
  interface H3EventContext {
    user: User | null
  }
}
```
