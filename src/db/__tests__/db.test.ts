import { describe, it, expect, afterEach } from 'vitest'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { createDb } from '../index.js'
import type { DbInstance } from '../types.js'

// Simple test schema
const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
})

const schema = { users }
type Schema = typeof schema

let db: DbInstance<Schema>

afterEach(() => {
  db?.close()
})

describe('createDb', () => {
  it('creates a SQLite in-memory database', () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    expect(db.drizzle).toBeDefined()
  })

  it('throws for unsupported drivers', () => {
    expect(() =>
      createDb({ driver: 'postgres', url: 'postgres://localhost/test' }),
    ).toThrow('Driver "postgres" requires additional peer dependencies')
  })
})

describe('paginate', () => {
  it('computes correct pagination metadata', () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    const data = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }))
    const result = db.paginate(data, 45, { page: 2, perPage: 10 })

    expect(result.page).toBe(2)
    expect(result.perPage).toBe(10)
    expect(result.total).toBe(45)
    expect(result.lastPage).toBe(5)
    expect(result.data).toHaveLength(10)
  })

  it('defaults to page 1 and perPage 15', () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    const result = db.paginate([], 0)
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(15)
    expect(result.lastPage).toBe(1)
  })
})

type TestUser = { id: string; name: string; email: string; age: number | null }
type SqliteRawClient = { prepare(sql: string): { run(): void } }

describe('factory', () => {
  it('makes items without inserting', () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    const userFactory = db.factory<TestUser>({
      build: (overrides) => ({
        id: crypto.randomUUID(),
        name: 'Alice',
        email: 'alice@example.com',
        age: null,
        ...overrides,
      }),
    })

    const user = userFactory.make({ name: 'Bob' })
    expect(user.name).toBe('Bob')
    expect(user.email).toBe('alice@example.com')
  })

  it('creates multiple items with createMany', async () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    let counter = 0
    const userFactory = db.factory<TestUser>({
      build: (overrides) => ({
        id: crypto.randomUUID(),
        name: `User ${++counter}`,
        email: `user${counter}@example.com`,
        age: null,
        ...overrides,
      }),
    })

    const items = await userFactory.createMany(3)
    expect(items).toHaveLength(3)
    expect(items[0]!.name).toBe('User 1')
    expect(items[1]!.name).toBe('User 2')
    expect(items[2]!.name).toBe('User 3')
  })

  it('calls insert function when provided', async () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    // Create the table first
    ;(db.drizzle as unknown as { $client: SqliteRawClient }).$client.prepare(
      'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)',
    ).run()

    const insertedIds: string[] = []
    const userFactory = db.factory<TestUser>({
      build: (overrides) => ({
        id: crypto.randomUUID(),
        name: 'Alice',
        email: `alice-${Math.random()}@example.com`,
        age: null,
        ...overrides,
      }),
      insert: async (dbInst, user) => {
        await dbInst.drizzle.insert(users).values(user)
        insertedIds.push(user.id)
        return user
      },
    })

    const user = await userFactory.create({ name: 'Charlie' })
    expect(user.name).toBe('Charlie')
    expect(insertedIds).toContain(user.id)
  })
})

describe('seed', () => {
  it('runs a seed function', async () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    ;(db.drizzle as unknown as { $client: SqliteRawClient }).$client.prepare(
      'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, age INTEGER)',
    ).run()

    let seeded = false
    await db.seed(async () => {
      seeded = true
    })
    expect(seeded).toBe(true)
  })

  it('wraps seed errors with a helpful message', async () => {
    db = createDb({ driver: 'sqlite', url: ':memory:' }, schema)
    await expect(
      db.seed(async () => {
        throw new Error('oops')
      }),
    ).rejects.toThrow('Seed failed: oops')
  })
})
