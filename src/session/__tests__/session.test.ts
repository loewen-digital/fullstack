import { describe, it, expect } from 'vitest'
import { createSession, createSessionManager, createMemoryDriver } from '../index.js'

describe('createSession with memory driver', () => {
  it('creates a new session with a generated id', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    expect(handle.id).toBeTruthy()
  })

  it('gets and sets values', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    handle.set('userId', 42)
    expect(handle.get('userId')).toBe(42)
  })

  it('forgets a key', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    handle.set('key', 'value')
    handle.forget('key')
    expect(handle.get('key')).toBeUndefined()
  })

  it('persists data across loads', async () => {
    const session = createSession({ driver: 'memory' })
    const handle1 = await session.load()
    handle1.set('name', 'Alice')
    await handle1.save()

    const handle2 = await session.load(handle1.id)
    expect(handle2.get('name')).toBe('Alice')
  })

  it('destroys a session', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    handle.set('key', 'val')
    await handle.save()
    await handle.destroy()

    const fresh = await session.load(handle.id)
    expect(fresh.get('key')).toBeUndefined()
  })

  it('regenerates session id', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    const originalId = handle.id
    await handle.regenerate()
    expect(handle.id).not.toBe(originalId)
  })
})

describe('flash messages', () => {
  it('flashes a value and reads it on next request', async () => {
    const driver = createMemoryDriver()
    const manager = createSessionManager(driver)

    const req1 = await manager.load()
    req1.flash('success', 'Saved!')
    await req1.save()

    // Simulate next request — rotates flash
    const req2 = await manager.load(req1.id)
    expect(req2.getFlash('success')).toBe('Saved!')
    await req2.save()

    // Flash should be gone on the request after that
    const req3 = await manager.load(req2.id)
    expect(req3.getFlash('success')).toBeUndefined()
  })
})

describe('old input', () => {
  it('flashes input and reads it on next request', async () => {
    const driver = createMemoryDriver()
    const manager = createSessionManager(driver)

    const req1 = await manager.load()
    req1.flashInput({ name: 'Alice', email: 'alice@example.com' })
    await req1.save()

    const req2 = await manager.load(req1.id)
    expect(req2.getOldInput('name')).toBe('Alice')
    expect(req2.getOldInput('email')).toBe('alice@example.com')
    await req2.save()

    // Old input should be gone after
    const req3 = await manager.load(req2.id)
    expect(req3.getOldInput('name')).toBeUndefined()
  })
})

describe('cookie driver', () => {
  it('is accessible via createSession', () => {
    const session = createSession({ driver: 'cookie', secret: 'test-secret' })
    expect(session).toBeDefined()
  })

  it('stores and retrieves data', async () => {
    const session = createSession({ driver: 'cookie', secret: 'my-secret' })
    const handle = await session.load()
    handle.set('role', 'admin')
    await handle.save()

    const resumed = await session.load(handle.id)
    expect(resumed.get('role')).toBe('admin')
  })
})

describe('redis driver', () => {
  it('throws when used via createSession (no client)', () => {
    expect(() => createSession({ driver: 'redis' })).toThrow('Redis session driver requires')
  })
})

describe('TTL parsing', () => {
  it('supports memory driver with 1h session', async () => {
    const session = createSession({ driver: 'memory', maxAge: '1h' })
    const handle = await session.load()
    handle.set('x', 1)
    await handle.save()
    const resumed = await session.load(handle.id)
    expect(resumed.get('x')).toBe(1)
  })
})
