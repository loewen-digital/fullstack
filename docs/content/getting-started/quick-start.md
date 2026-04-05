---
title: Quick Start
description: Build a working auth + validation example in under five minutes
---

# Quick Start

This guide walks you through setting up a minimal but real application with database access, validation, and authentication. We'll use SvelteKit as the framework, but the core logic is identical in any framework.

## 1. Set up the database

Create a `src/lib/db.ts` file:

```ts
import { createDb } from '@loewen-digital/fullstack/db'

export const db = createDb({
  driver: 'sqlite',
  url: './app.db',
})
```

## 2. Set up authentication

Create `src/lib/auth.ts`:

```ts
import { createAuth } from '@loewen-digital/fullstack/auth'
import { db } from './db.js'

export const auth = createAuth({
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

## 3. Handle a login form

In a SvelteKit `+page.server.ts`:

```ts
import { validate } from '@loewen-digital/fullstack/validation'
import { auth } from '$lib/auth.js'
import { fail, redirect } from '@sveltejs/kit'
import type { Actions } from './$types'

export const actions: Actions = {
  login: async ({ request }) => {
    const formData = await request.formData()

    // Validate the input
    const result = validate(Object.fromEntries(formData), {
      email: ['required', 'email'],
      password: ['required', 'string'],
    })

    if (!result.passes) {
      return fail(422, { errors: result.errors })
    }

    // Attempt authentication
    const user = await auth.attempt({
      email: result.data.email,
      password: result.data.password,
    })

    if (!user) {
      return fail(401, { error: 'Invalid credentials' })
    }

    // Create a session
    await auth.login(user, { remember: formData.get('remember') === 'on' })

    redirect(302, '/dashboard')
  },
}
```

## 4. Protect a route

```ts
// src/routes/dashboard/+page.server.ts
import { auth } from '$lib/auth.js'
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ request }) => {
  const user = await auth.user(request)

  if (!user) {
    redirect(302, '/login')
  }

  return { user }
}
```

## What's next?

- Add [validation rules](/modules/validation) to your forms
- Set up [mail](/modules/mail) for email verification
- Configure [storage](/modules/storage) for file uploads
- Explore the [SvelteKit adapter](/adapters/sveltekit) for session middleware
