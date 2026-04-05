---
title: Astro Adapter
description: Integrate @loewen-digital/fullstack into an Astro application
---

# Astro Adapter

The Astro adapter integrates `@loewen-digital/fullstack` via Astro middleware, making the current user available in `.astro` pages and API endpoints through `Astro.locals`.

## Import

```ts
import { createMiddleware } from '@loewen-digital/fullstack/adapters/astro'
```

## Setup

### 1. Enable SSR

Ensure your Astro project has SSR enabled in `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
})
```

### 2. Create your stack

```ts
// src/lib/stack.ts
import { createDb } from '@loewen-digital/fullstack/db'
import { createAuth } from '@loewen-digital/fullstack/auth'

export const db = createDb({ driver: 'sqlite', url: './app.db' })

export const auth = createAuth({
  db,
  session: { driver: 'cookie', secret: import.meta.env.SESSION_SECRET },
})
```

### 3. Add middleware

```ts
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware'
import { createMiddleware } from '@loewen-digital/fullstack/adapters/astro'
import { auth } from './lib/stack.js'

const fullstackMiddleware = createMiddleware({ auth })

export const onRequest = defineMiddleware(async (context, next) => {
  await fullstackMiddleware(context)
  return next()
})
```

### 4. Augment `App.Locals`

```ts
// src/env.d.ts
import type { User } from '@loewen-digital/fullstack/auth'

declare namespace App {
  interface Locals {
    user: User | null
  }
}
```

## Using in pages

```astro
---
// src/pages/dashboard.astro
import { redirect } from 'astro:transitions/client'

const { user } = Astro.locals

if (!user) {
  return redirect('/login')
}
---

<h1>Welcome, {user.name}</h1>
```

## API endpoints

```ts
// src/pages/api/profile.ts
import type { APIRoute } from 'astro'

export const GET: APIRoute = ({ locals }) => {
  const user = locals.user

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  return new Response(JSON.stringify({ user }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

## Notes

- Astro's `context.request` is a Web Standard `Request` — no conversion needed
- API endpoints return Web Standard `Response` objects — fully compatible with all `@loewen-digital/fullstack` modules
- The adapter works with any Astro server adapter (Node, Cloudflare, Vercel, etc.)
