---
title: Factories
description: Model factories for generating realistic test data
---

# Factories

Factories generate realistic test data for your database models. They integrate with Drizzle schema and respect your column types and constraints.

## Import

```ts
import { defineFactory, createSeeder } from '@loewen-digital/fullstack/testing'
```

## Defining a factory

```ts
import { defineFactory } from '@loewen-digital/fullstack/testing'
import { users, posts } from '../db/schema.js'

const userFactory = defineFactory(users, {
  name: () => 'Alice Example',
  email: (i) => `user${i}@example.com`,
  passwordHash: () => '$argon2id$...',
  createdAt: () => new Date(),
  active: () => true,
})

const postFactory = defineFactory(posts, {
  title: (i) => `Post number ${i}`,
  body: () => 'Lorem ipsum dolor sit amet...',
  status: () => 'draft',
  authorId: () => 1,
  publishedAt: () => null,
})
```

## Creating records in tests

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestStack } from '@loewen-digital/fullstack/testing'

describe('post listing', () => {
  let stack: ReturnType<typeof createTestStack>

  beforeEach(() => {
    stack = createTestStack()
  })

  it('returns only published posts', async () => {
    // Create specific records
    await userFactory.create(stack.db, { name: 'Alice' })
    await postFactory.create(stack.db, { status: 'published' })
    await postFactory.create(stack.db, { status: 'draft' })

    const published = await stack.db.query.posts.findMany({
      where: (p, { eq }) => eq(p.status, 'published'),
    })

    expect(published).toHaveLength(1)
  })
})
```

## Creating multiple records

```ts
// Create 5 users
const users = await userFactory.createMany(db, 5)

// Create 3 posts for a specific user
const posts = await postFactory.createMany(db, 3, { authorId: user.id })
```

## Overriding attributes

Pass any attribute to override the factory default:

```ts
const admin = await userFactory.create(db, {
  email: 'admin@example.com',
  role: 'admin',
})
```

## States

Define named states for common variations:

```ts
const postFactory = defineFactory(posts, {
  title: (i) => `Post ${i}`,
  status: () => 'draft',
}).state('published', {
  status: 'published',
  publishedAt: () => new Date(),
}).state('archived', {
  status: 'archived',
})

// Use a state
const publishedPost = await postFactory.published().create(db)
const archivedPost  = await postFactory.archived().create(db)
```

## Building without persisting

```ts
// Returns a plain object without inserting into the database
const userData = userFactory.build({ name: 'Bob' })
```

## Seeder integration

Compose factories into seeders for development data:

```ts
import { createSeeder } from '@loewen-digital/fullstack/testing'

export const seed = createSeeder(async (db) => {
  const alice = await userFactory.create(db, { email: 'alice@example.com' })
  await postFactory.createMany(db, 5, { authorId: alice.id, status: 'published' })
})
```

```bash
npx fullstack db:seed
```
