import { describe, it, expect, vi } from 'vitest'
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

  it('destroy() clears the data, so a later save writes an empty session', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.load()
    handle.set('key', 'val')
    await handle.save()
    await handle.destroy()

    expect(handle.get('key')).toBeUndefined()
    await handle.save()
    expect((await session.load(handle.id)).get('key')).toBeUndefined()
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

describe('open and commit', () => {
  it('memory driver: commit returns the id, open resumes by id', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.open()
    handle.set('n', 1)

    const value = await session.commit(handle)
    expect(value).toBe(handle.id)
    expect((await session.open(value)).get('n')).toBe(1)
  })

  it('memory driver: open with an unknown id starts an empty session under that id', async () => {
    const session = createSession({ driver: 'memory' })
    const handle = await session.open('unknown')
    expect(handle.id).toBe('unknown')
    expect(handle.get('n')).toBeUndefined()
  })
})

describe('cookie driver', () => {
  const secret = 'test-secret'

  it('is accessible via createSession', () => {
    const session = createSession({ driver: 'cookie', secret })
    expect(session).toBeDefined()
  })

  it('requires a secret', () => {
    expect(() => createSession({ driver: 'cookie' })).toThrow('requires a `secret`')
  })

  it('carries id and data in the committed value: a fresh manager reads them back', async () => {
    const first = createSession({ driver: 'cookie', secret })
    const handle = await first.open()
    handle.set('role', 'admin')
    handle.flash('notice', 'Gespeichert – ä ö ü')
    const value = await first.commit(handle)

    const second = createSession({ driver: 'cookie', secret })
    const resumed = await second.open(value)
    expect(resumed.id).toBe(handle.id)
    expect(resumed.get('role')).toBe('admin')
    expect(resumed.getFlash('notice')).toBe('Gespeichert – ä ö ü')
  })

  it('opens an empty session under a new id for a tampered, unsigned, foreign or garbage value', async () => {
    const session = createSession({ driver: 'cookie', secret })
    const handle = await session.open()
    handle.set('role', 'admin')
    const value = await session.commit(handle)
    const [payload, sig] = value.split('.') as [string, string]

    const foreign = createSession({ driver: 'cookie', secret: 'another-secret' })
    const foreignHandle = await foreign.open()
    foreignHandle.set('role', 'admin')

    const bad = [
      `${payload.slice(0, -1)}${payload.endsWith('A') ? 'B' : 'A'}.${sig}`,
      payload,
      await foreign.commit(foreignHandle),
      'garbage',
      '',
    ]
    for (const candidate of bad) {
      const opened = await session.open(candidate)
      expect(opened.get('role')).toBeUndefined()
      expect(opened.id).not.toBe(handle.id)
    }
  })

  it('rejects a value older than maxAge', async () => {
    vi.useFakeTimers()
    try {
      const session = createSession({ driver: 'cookie', secret, maxAge: '1m' })
      const handle = await session.open()
      handle.set('x', 1)
      const value = await session.commit(handle)

      vi.advanceTimersByTime(59_000)
      expect((await session.open(value)).get('x')).toBe(1)

      vi.advanceTimersByTime(2_000)
      expect((await session.open(value)).get('x')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('regenerate() and destroy() show in the committed value', async () => {
    const session = createSession({ driver: 'cookie', secret })
    const handle = await session.open()
    handle.set('role', 'admin')
    const before = handle.id

    await handle.regenerate()
    const regenerated = await session.open(await session.commit(handle))
    expect(regenerated.id).not.toBe(before)
    expect(regenerated.get('role')).toBe('admin')

    await handle.destroy()
    const destroyed = await session.open(await session.commit(handle))
    expect(destroyed.get('role')).toBeUndefined()
  })

  it('commit() refuses a handle another manager opened', async () => {
    const cookie = createSession({ driver: 'cookie', secret })
    const memory = createSession({ driver: 'memory' })
    const handle = await memory.open()
    await expect(cookie.commit(handle)).rejects.toThrow('not opened by this session manager')
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
