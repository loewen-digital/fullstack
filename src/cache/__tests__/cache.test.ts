import { describe, it, expect, vi } from 'vitest'
import { createCache, createCacheInstance, createMemoryDriver } from '../index.js'

describe('createCache', () => {
  it('creates instance with memory driver', () => {
    const cache = createCache({ driver: 'memory' })
    expect(cache).toBeDefined()
    expect(cache.get).toBeInstanceOf(Function)
    expect(cache.set).toBeInstanceOf(Function)
  })

  it('throws on unknown driver', () => {
    expect(() => createCache({ driver: 'unknown' })).toThrow('Unknown cache driver')
  })

  it('throws on redis driver without config', () => {
    expect(() => createCache({ driver: 'redis' })).toThrow('Redis cache driver requires')
  })

  it('throws on kv driver without config', () => {
    expect(() => createCache({ driver: 'kv' })).toThrow('KV cache driver requires')
  })
})

describe('memory driver', () => {
  it('sets and gets a value', async () => {
    const cache = createCache({ driver: 'memory' })
    await cache.set('key', 'value')
    expect(await cache.get('key')).toBe('value')
  })

  it('returns null for missing key', async () => {
    const cache = createCache({ driver: 'memory' })
    expect(await cache.get('missing')).toBeNull()
  })

  it('stores complex objects', async () => {
    const cache = createCache({ driver: 'memory' })
    const obj = { name: 'Alice', age: 30, tags: ['a', 'b'] }
    await cache.set('user', obj)
    expect(await cache.get('user')).toEqual(obj)
  })

  it('checks key existence', async () => {
    const cache = createCache({ driver: 'memory' })
    expect(await cache.has('key')).toBe(false)
    await cache.set('key', 'value')
    expect(await cache.has('key')).toBe(true)
  })

  it('deletes a key', async () => {
    const cache = createCache({ driver: 'memory' })
    await cache.set('key', 'value')
    expect(await cache.delete('key')).toBe(true)
    expect(await cache.get('key')).toBeNull()
  })

  it('returns false when deleting non-existent key', async () => {
    const cache = createCache({ driver: 'memory' })
    expect(await cache.delete('missing')).toBe(false)
  })

  it('flushes all keys', async () => {
    const cache = createCache({ driver: 'memory' })
    await cache.set('a', 1)
    await cache.set('b', 2)
    await cache.flush()
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  it('respects TTL expiration', async () => {
    const cache = createCache({ driver: 'memory' })
    vi.useFakeTimers()
    try {
      await cache.set('key', 'value', 1) // 1 second TTL
      expect(await cache.get('key')).toBe('value')
      vi.advanceTimersByTime(1500) // 1.5 seconds later
      expect(await cache.get('key')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('has() returns false for expired keys', async () => {
    const cache = createCache({ driver: 'memory' })
    vi.useFakeTimers()
    try {
      await cache.set('key', 'value', 1)
      vi.advanceTimersByTime(1500)
      expect(await cache.has('key')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies default TTL from config', async () => {
    const cache = createCache({ driver: 'memory', ttl: '1s' })
    vi.useFakeTimers()
    try {
      await cache.set('key', 'value') // No explicit TTL — uses default
      expect(await cache.get('key')).toBe('value')
      vi.advanceTimersByTime(1500)
      expect(await cache.get('key')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('remember', () => {
  it('returns cached value if present', async () => {
    const cache = createCache({ driver: 'memory' })
    await cache.set('key', 'cached')
    const fn = vi.fn(() => 'computed')
    const result = await cache.remember('key', 60, fn)
    expect(result).toBe('cached')
    expect(fn).not.toHaveBeenCalled()
  })

  it('computes and stores value if missing', async () => {
    const cache = createCache({ driver: 'memory' })
    const fn = vi.fn(() => 'computed')
    const result = await cache.remember('key', 60, fn)
    expect(result).toBe('computed')
    expect(fn).toHaveBeenCalledOnce()
    expect(await cache.get('key')).toBe('computed')
  })

  it('supports async compute functions', async () => {
    const cache = createCache({ driver: 'memory' })
    const result = await cache.remember('key', 60, async () => {
      return { data: 42 }
    })
    expect(result).toEqual({ data: 42 })
  })
})

describe('createCacheInstance', () => {
  it('works with a custom driver', async () => {
    const driver = createMemoryDriver()
    const cache = createCacheInstance(driver)
    await cache.set('key', 'value')
    expect(await cache.get('key')).toBe('value')
  })
})
