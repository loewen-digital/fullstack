import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { flatdb, collection, MemoryAdapter, type Collection } from '@loewen-digital/flatdb'
import { z } from 'zod'
import { createAuth } from '../index.js'
import { createFlatdbAuthAdapter } from '../adapters/flatdb.js'
import type { AuthDbAdapter } from '../types.js'

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// UPSTREAM: https://github.com/loewen-digital/flatdb/issues/7 — FlatDb<T> types every
// collection as `Collection | PathCollection`, so auto-mode collections are cast here.
function openDb(userSchema?: z.ZodType) {
  const db = flatdb(new MemoryAdapter(), {
    users: collection(userSchema),
    sessions: collection(),
    tokens: collection(),
  })
  return {
    users: db.users as Collection,
    sessions: db.sessions as Collection,
    tokens: db.tokens as Collection,
  }
}

let db: ReturnType<typeof openDb>
let adapter: AuthDbAdapter
let auth: ReturnType<typeof createAuth>

beforeEach(() => {
  db = openDb()
  adapter = createFlatdbAuthAdapter(db)
  auth = createAuth({}, { db: adapter })
})

describe('full auth flow on flatdb', () => {
  it('runs sessions, one-time tokens, email verification and password reset through createAuth', async () => {
    const inserted = await db.users.insert({ email: 'alice@example.com', passwordHash: null, emailVerifiedAt: null })
    const user = await adapter.findUserByEmail('alice@example.com')
    expect(user).toEqual({ id: inserted._id, email: 'alice@example.com', passwordHash: null, emailVerifiedAt: null })

    // session: create, validate, destroy
    const session = await auth.createSession(user!)
    expect(session.userId).toBe(user!.id)
    const valid = await auth.validateSession(session.token)
    expect(valid?.id).toBe(session.id)
    expect(valid?.expiresAt).toBeInstanceOf(Date)
    expect(valid?.createdAt).toBeInstanceOf(Date)
    await auth.destroySession(session.token)
    expect(await auth.validateSession(session.token)).toBeNull()

    // one-time token: verifies once
    const token = await auth.generateToken(user!.id, 'invite')
    expect(await auth.verifyToken(token, 'invite')).toBe(user!.id)
    expect(await auth.verifyToken(token, 'invite')).toBeNull()
    expect(await auth.verifyToken(token, 'other-type')).toBeNull()

    // email verification
    let sent = ''
    await auth.sendVerificationEmail(user!, async (_email, t) => { sent = t })
    const verified = await auth.verifyEmail(sent)
    expect(verified?.id).toBe(user!.id)
    expect(verified?.emailVerifiedAt).toBeInstanceOf(Date)

    // password reset
    await auth.sendPasswordResetEmail(user!, async (_email, t) => { sent = t })
    expect(await auth.resetPassword(sent, 'new-secret')).toBe(true)
    const updated = await adapter.findUserById(user!.id)
    expect(await auth.verifyPassword('new-secret', updated!.passwordHash!)).toBe(true)
    expect(await auth.resetPassword(sent, 'again')).toBe(false)
  })

  it('exposes flatdb _id as id and stores dates as ISO strings', async () => {
    const { _id } = await db.users.insert({ email: 'bob@example.com' })
    const user = await adapter.findUserById(_id)
    expect(user).not.toHaveProperty('_id')
    expect(user?.id).toBe(_id)

    const session = await auth.createSession(user!)
    const raw = await db.sessions.findById(session.id)
    expect(raw?.expiresAt).toMatch(ISO)
    expect(raw?.createdAt).toMatch(ISO)
    expect(new Date(raw!.expiresAt as string).getTime()).toBe(session.expiresAt.getTime())

    const token = await auth.generateToken(user!.id, 'invite')
    await auth.verifyToken(token, 'invite')
    const rawToken = await db.tokens.findOne({ token })
    expect(rawToken?.usedAt).toMatch(ISO)
    const found = await adapter.findToken(token, 'invite')
    expect(found?.usedAt).toBeInstanceOf(Date)
  })

  it('expired sessions are rejected and removed', async () => {
    const { _id } = await db.users.insert({ email: 'carol@example.com' })
    const expired = await adapter.createSession({
      userId: _id,
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 2000),
    })
    expect(await auth.validateSession(expired.token)).toBeNull()
    expect(await db.sessions.findById(expired.id)).toBeNull()
  })
})

describe('deleteExpiredSessions', () => {
  it('removes only the given user\'s expired sessions', async () => {
    const past = new Date(Date.now() - 60_000)
    const future = new Date(Date.now() + 60_000)
    const base = { createdAt: past }
    await adapter.createSession({ ...base, userId: 'u1', token: 'u1-expired', expiresAt: past })
    await adapter.createSession({ ...base, userId: 'u1', token: 'u1-live', expiresAt: future })
    await adapter.createSession({ ...base, userId: 'u2', token: 'u2-expired', expiresAt: past })

    await adapter.deleteExpiredSessions('u1')

    expect(await adapter.findSession('u1-expired')).toBeNull()
    expect(await adapter.findSession('u1-live')).not.toBeNull()
    expect(await adapter.findSession('u2-expired')).not.toBeNull()
  })

  it('runs on login through createAuth', async () => {
    const { _id } = await db.users.insert({ email: 'dave@example.com' })
    await adapter.createSession({
      userId: _id,
      token: 'stale',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(Date.now() - 2000),
    })
    const user = await adapter.findUserById(_id)
    await auth.createSession(user!)
    expect(await adapter.findSession('stale')).toBeNull()
  })
})

describe('users collection with a zod schema', () => {
  const schema = z.object({
    email: z.string(),
    name: z.string(),
    passwordHash: z.string().nullable().optional(),
    emailVerifiedAt: z.string().nullable().optional(),
  })

  it('reads and writes the auth fields through the schema', async () => {
    db = openDb(schema)
    adapter = createFlatdbAuthAdapter(db)
    auth = createAuth({}, { db: adapter })

    const { _id } = await db.users.insert({ email: 'erin@example.com', name: 'Erin' })
    const user = await adapter.findUserById(_id)
    expect(user).toEqual({ id: _id, email: 'erin@example.com', passwordHash: null, emailVerifiedAt: null })

    await adapter.markEmailVerified(_id)
    await adapter.updateUserPassword(_id, 'scrypt:hash')
    const after = await adapter.findUserById(_id)
    expect(after?.emailVerifiedAt).toBeInstanceOf(Date)
    expect(after?.passwordHash).toBe('scrypt:hash')
    expect((await db.users.findById(_id))?.name).toBe('Erin')
  })

  it('a schema that does not declare the auth fields loses them on write', async () => {
    db = openDb(z.object({ name: z.string() }))
    adapter = createFlatdbAuthAdapter(db)

    const { _id } = await db.users.insert({ name: 'No Email', email: 'stripped@example.com' })
    await expect(adapter.findUserById(_id)).rejects.toThrow(/must declare email/)
    expect(await adapter.findUserByEmail('stripped@example.com')).toBeNull()
  })
})

describe('packaging', () => {
  it('the adapter imports neither flatdb nor node built-ins, and the auth entry does not load it', () => {
    const adapterSource = readFileSync(new URL('../adapters/flatdb.ts', import.meta.url), 'utf8')
    expect(adapterSource).not.toMatch(/from ['"]@loewen-digital\/flatdb/)
    expect(adapterSource).not.toMatch(/from ['"]node:/)

    const entrySource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    expect(entrySource).not.toMatch(/adapters\/flatdb/)
  })
})
