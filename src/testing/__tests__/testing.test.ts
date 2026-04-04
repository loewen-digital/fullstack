import { describe, it, expect, beforeEach } from 'vitest'
import { createTestStack } from '../index.js'
import { createFakeMailDriver } from '../fake-mail.js'
import { createFakeQueueDriver } from '../fake-queue.js'
import { createFakeStorageDriver } from '../fake-storage.js'
import { defineFactory, sequence, pick } from '../factories.js'
import { createMailInstance } from '../../mail/index.js'
import { createQueueInstance } from '../../queue/index.js'
import { createStorageInstance } from '../../storage/index.js'

// ── createTestStack ─────────────────────────────────────────────────────────

describe('createTestStack', () => {
  it('creates all modules with defaults', () => {
    const stack = createTestStack()
    expect(stack.db).toBeDefined()
    expect(stack.mail).toBeDefined()
    expect(stack.storage).toBeDefined()
    expect(stack.queue).toBeDefined()
    expect(stack.cache).toBeDefined()
    expect(stack.session).toBeDefined()
    expect(stack.fakeMail).toBeDefined()
    expect(stack.fakeQueue).toBeDefined()
    expect(stack.fakeStorage).toBeDefined()
  })

  it('exposes fake drivers for assertions', async () => {
    const stack = createTestStack()

    await stack.mail.send({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'World',
    })

    expect(stack.fakeMail.sent).toHaveLength(1)
    expect(stack.fakeMail.sent[0]?.subject).toBe('Hello')
  })

  it('reset() clears all fakes', async () => {
    const stack = createTestStack()

    await stack.mail.send({ to: 'user@example.com', subject: 'Hello', text: '' })
    await stack.queue.dispatch({ name: 'job', payload: {} })
    await stack.storage.put('file.txt', 'data')

    stack.reset()

    expect(stack.fakeMail.sent).toHaveLength(0)
    expect(stack.fakeQueue.dispatched).toHaveLength(0)
    expect(stack.fakeStorage.keys()).toHaveLength(0)
  })

  it('cache works independently between test stacks', async () => {
    const s1 = createTestStack()
    const s2 = createTestStack()

    await s1.cache.set('key', 'value-1')
    await s2.cache.set('key', 'value-2')

    expect(await s1.cache.get('key')).toBe('value-1')
    expect(await s2.cache.get('key')).toBe('value-2')
  })

  it('session works with memory driver', async () => {
    const stack = createTestStack()
    const handle = await stack.session.load()
    handle.set('userId', 99)
    await handle.save()

    const handle2 = await stack.session.load(handle.id)
    expect(handle2.get('userId')).toBe(99)
  })
})

// ── FakeMailDriver ─────────────────────────────────────────────────────────

describe('FakeMailDriver', () => {
  let fake: ReturnType<typeof createFakeMailDriver>
  let mail: ReturnType<typeof createMailInstance>

  beforeEach(() => {
    fake = createFakeMailDriver()
    mail = createMailInstance(fake, { driver: 'console' })
  })

  it('captures sent messages', async () => {
    await mail.send({ to: 'a@example.com', subject: 'S1', text: 'T' })
    await mail.send({ to: 'b@example.com', subject: 'S2', text: 'T' })
    expect(fake.sent).toHaveLength(2)
  })

  it('lastSent() returns the most recent message', async () => {
    await mail.send({ to: 'a@example.com', subject: 'First', text: '' })
    await mail.send({ to: 'b@example.com', subject: 'Second', text: '' })
    expect(fake.lastSent()?.subject).toBe('Second')
  })

  it('lastSent() returns undefined when no messages', () => {
    expect(fake.lastSent()).toBeUndefined()
  })

  it('sentTo() filters by recipient', async () => {
    await mail.send({ to: 'alice@example.com', subject: 'For Alice', text: '' })
    await mail.send({ to: 'bob@example.com', subject: 'For Bob', text: '' })

    expect(fake.sentTo('alice@example.com')).toHaveLength(1)
    expect(fake.sentTo('alice@example.com')[0]?.subject).toBe('For Alice')
    expect(fake.sentTo('nobody@example.com')).toHaveLength(0)
  })

  it('sentWithSubject() filters by subject', async () => {
    await mail.send({ to: 'a@example.com', subject: 'Welcome', text: '' })
    await mail.send({ to: 'b@example.com', subject: 'Alert', text: '' })

    expect(fake.sentWithSubject('Welcome')).toHaveLength(1)
    expect(fake.sentWithSubject('Missing')).toHaveLength(0)
  })

  it('clear() removes all captured messages', async () => {
    await mail.send({ to: 'a@example.com', subject: 'X', text: '' })
    fake.clear()
    expect(fake.sent).toHaveLength(0)
  })
})

// ── FakeQueueDriver ─────────────────────────────────────────────────────────

describe('FakeQueueDriver', () => {
  let fake: ReturnType<typeof createFakeQueueDriver>
  let queue: ReturnType<typeof createQueueInstance>

  beforeEach(() => {
    fake = createFakeQueueDriver()
    queue = createQueueInstance(fake)
  })

  it('captures dispatched jobs', async () => {
    await queue.dispatch({ name: 'send-email', payload: { to: 'user@example.com' } })
    expect(fake.dispatched).toHaveLength(1)
    expect(fake.dispatched[0]?.name).toBe('send-email')
  })

  it('processes jobs with registered handlers', async () => {
    const results: unknown[] = []
    queue.handle('echo', async (job) => {
      results.push(job.payload)
    })

    await queue.dispatch({ name: 'echo', payload: { msg: 'hello' } })
    await queue.process()

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ msg: 'hello' })
  })

  it('clear() removes all jobs', async () => {
    await queue.dispatch({ name: 'job', payload: {} })
    fake.clear()
    expect(fake.dispatched).toHaveLength(0)
    expect(await queue.size()).toBe(0)
  })

  it('failed jobs are tracked', async () => {
    queue.handle('bad-job', async () => {
      throw new Error('job failed')
    })

    await queue.dispatch({ name: 'bad-job', payload: {}, maxAttempts: 1 })
    await queue.process()

    expect(fake.failedJobs).toHaveLength(1)
  })
})

// ── FakeStorageDriver ───────────────────────────────────────────────────────

describe('FakeStorageDriver', () => {
  let fake: ReturnType<typeof createFakeStorageDriver>
  let storage: ReturnType<typeof createStorageInstance>

  beforeEach(() => {
    fake = createFakeStorageDriver()
    storage = createStorageInstance(fake)
  })

  it('stores and retrieves files', async () => {
    await storage.put('test.txt', 'hello')
    const content = await storage.getText('test.txt')
    expect(content).toBe('hello')
  })

  it('exists() returns correct results', async () => {
    expect(await storage.exists('missing.txt')).toBe(false)
    await storage.put('present.txt', 'data')
    expect(await storage.exists('present.txt')).toBe(true)
  })

  it('delete() removes files', async () => {
    await storage.put('file.txt', 'data')
    await storage.delete('file.txt')
    expect(await storage.exists('file.txt')).toBe(false)
  })

  it('list() returns all keys', async () => {
    await storage.put('a.txt', '')
    await storage.put('b.txt', '')
    await storage.put('subdir/c.txt', '')
    const all = await storage.list()
    expect(all.sort()).toEqual(['a.txt', 'b.txt', 'subdir/c.txt'])
  })

  it('list() filters by prefix', async () => {
    await storage.put('images/1.png', '')
    await storage.put('images/2.png', '')
    await storage.put('docs/1.pdf', '')
    expect(await storage.list('images/')).toHaveLength(2)
    expect(await storage.list('docs/')).toHaveLength(1)
  })

  it('keys() and size track state', async () => {
    expect(fake.size).toBe(0)
    await storage.put('a.txt', '')
    await storage.put('b.txt', '')
    expect(fake.size).toBe(2)
    expect(fake.keys().sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('clear() empties the store', async () => {
    await storage.put('file.txt', 'data')
    fake.clear()
    expect(fake.size).toBe(0)
  })

  it('getUrl() returns a URL', async () => {
    const url = await storage.getUrl('avatar.png')
    expect(url).toContain('avatar.png')
  })
})

// ── defineFactory ───────────────────────────────────────────────��─────────

describe('defineFactory', () => {
  const userFactory = defineFactory({
    id: () => Math.floor(Math.random() * 10000),
    name: () => 'Alice',
    email: () => 'alice@example.com',
    role: () => 'user' as 'user' | 'admin',
  })

  it('make() returns a record with default values', () => {
    const user = userFactory.make()
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@example.com')
    expect(user.role).toBe('user')
  })

  it('make() applies overrides', () => {
    const admin = userFactory.make({ role: 'admin', name: 'Bob' })
    expect(admin.role).toBe('admin')
    expect(admin.name).toBe('Bob')
  })

  it('makeMany() returns N records', () => {
    const users = userFactory.makeMany(5)
    expect(users).toHaveLength(5)
    users.forEach(u => expect(u.name).toBe('Alice'))
  })

  it('makeMany() applies overrides to all', () => {
    const admins = userFactory.makeMany(3, { role: 'admin' })
    admins.forEach(a => expect(a.role).toBe('admin'))
  })

  it('state() creates a variant factory', () => {
    const adminFactory = userFactory.state({ role: () => 'admin', name: () => 'Admin User' })
    const admin = adminFactory.make()
    expect(admin.role).toBe('admin')
    expect(admin.name).toBe('Admin User')
    // Original factory unchanged
    expect(userFactory.make().role).toBe('user')
  })

  it('each make() call gets fresh values', () => {
    const counter = sequence(1)
    const f = defineFactory({ id: counter })
    const a = f.make()
    const b = f.make()
    expect(a.id).not.toBe(b.id)
  })
})

describe('sequence', () => {
  it('increments from start', () => {
    const seq = sequence(10)
    expect(seq()).toBe(10)
    expect(seq()).toBe(11)
    expect(seq()).toBe(12)
  })

  it('starts from 1 by default', () => {
    const seq = sequence()
    expect(seq()).toBe(1)
  })
})

describe('pick', () => {
  it('returns a value from the array', () => {
    const fn = pick(['a', 'b', 'c'])
    const val = fn()
    expect(['a', 'b', 'c']).toContain(val)
  })
})
