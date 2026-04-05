---
title: SvelteKit Adapter
description: Integrate @loewen-digital/fullstack into a SvelteKit application
---

# SvelteKit Adapter

The SvelteKit adapter provides a `createHandle()` function that wires the auth module into SvelteKit's server hooks, populating `event.locals` with the current user on every request.

## Import

```ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
```

## Setup

### 1. Create your stack

```ts
// src/lib/server/stack.ts
import { createDb } from '@loewen-digital/fullstack/db'
import { createAuth } from '@loewen-digital/fullstack/auth'

export const db = createDb({ driver: 'sqlite', url: './app.db' })

export const auth = createAuth({
  db,
  session: { driver: 'cookie', secret: process.env.SESSION_SECRET! },
})
```

### 2. Add the handle hook

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth } from '$lib/server/stack.js'

export const handle = createHandle({ auth })
```

### 3. Augment `App.Locals`

```ts
// src/app.d.ts
import type { User } from '@loewen-digital/fullstack/auth'

declare global {
  namespace App {
    interface Locals {
      user: User | null
    }
  }
}
```

## Using the current user

In any `+page.server.ts` or `+server.ts`:

```ts
import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    redirect(302, '/login')
  }

  return { user: locals.user }
}
```

## Form actions

```ts
// src/routes/login/+page.server.ts
import { validate } from '@loewen-digital/fullstack/validation'
import { auth } from '$lib/server/stack.js'
import { fail, redirect } from '@sveltejs/kit'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async ({ request }) => {
    const data = Object.fromEntries(await request.formData())

    const result = validate(data, {
      email: ['required', 'email'],
      password: ['required'],
    })

    if (!result.passes) {
      return fail(422, { errors: result.errors })
    }

    const user = await auth.attempt(result.data)

    if (!user) {
      return fail(401, { error: 'Invalid credentials' })
    }

    await auth.login(user)
    redirect(302, '/dashboard')
  },
}
```

## Combining multiple handles

Use SvelteKit's `sequence` helper if you have other handles:

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks'
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { auth } from '$lib/server/stack.js'

const authHandle = createHandle({ auth })

export const handle = sequence(authHandle, yourOtherHandle)
```
