---
title: Testing Overview
description: Testing strategies and helpers for @loewen-digital/fullstack applications
---

# Testing Overview

`@loewen-digital/fullstack` is designed to be testable from the ground up. Every module accepts an in-memory driver, so tests never need a real database, SMTP server, Redis instance, or any external service.

## Import

```ts
import { createTestStack } from '@loewen-digital/fullstack/testing'
```

## The `createTestStack` helper

`createTestStack` creates a fully configured stack with all in-memory drivers pre-wired. Use it as the foundation of your integration tests:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestStack } from '@loewen-digital/fullstack/testing'

describe('user registration', () => {
  let stack: ReturnType<typeof createTestStack>

  beforeEach(() => {
    stack = createTestStack()
    // Fresh, empty in-memory stack for every test
  })

  it('registers a new user and sends a welcome email', async () => {
    const { auth, mail, db } = stack

    await auth.register({ email: 'alice@example.com', password: 'password123' })

    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, 'alice@example.com'),
    })

    expect(user).toBeDefined()
    expect(user!.email).toBe('alice@example.com')

    mail.assertSent({ to: 'alice@example.com', subject: 'Welcome!' })
  })
})
```

## Using in-memory drivers directly

You don't need `createTestStack` — you can configure any module with an in-memory driver:

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
import { createCache } from '@loewen-digital/fullstack/cache'

const mail = createMail({ driver: 'memory' })
const cache = createCache({ driver: 'memory' })
```

## Test isolation

Because factory functions create independent instances, each test gets its own isolated module state:

```ts
beforeEach(() => {
  // New instance = empty state, no cross-test contamination
  stack = createTestStack()
})
```

## Database helpers

The `testing` module includes helpers for seeding and clearing the test database:

```ts
import { seedDatabase, clearDatabase } from '@loewen-digital/fullstack/testing'

beforeEach(async () => {
  await clearDatabase(stack.db)
  await seedDatabase(stack.db, { users: 5, posts: 10 })
})
```

## What's in this section

- [Fakes](/testing/fakes) — fake implementations for mail, queue, events, and more
- [Factories](/testing/factories) — model factories for generating test data
