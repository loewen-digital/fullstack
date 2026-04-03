import { describe, it, expect, vi } from 'vitest'
import { createEventBus, defineEvents } from '../index.js'

interface TestEvents {
  'user.created': { id: number; name: string }
  'post.published': { slug: string }
  'ping': undefined
}

describe('createEventBus', () => {
  it('calls registered listener when event is emitted', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    bus.on('user.created', spy)
    await bus.emit('user.created', { id: 1, name: 'Alice' })
    expect(spy).toHaveBeenCalledWith({ id: 1, name: 'Alice' })
  })

  it('calls multiple listeners for the same event', async () => {
    const bus = createEventBus<TestEvents>()
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    bus.on('user.created', spy1)
    bus.on('user.created', spy2)
    await bus.emit('user.created', { id: 1, name: 'Bob' })
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
  })

  it('does not call listener after off()', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    bus.on('user.created', spy)
    bus.off('user.created', spy)
    await bus.emit('user.created', { id: 1, name: 'Charlie' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe function from on()', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    const unsub = bus.on('user.created', spy)
    unsub()
    await bus.emit('user.created', { id: 1, name: 'Dave' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('once() listener fires only once', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    bus.once('user.created', spy)
    await bus.emit('user.created', { id: 1, name: 'Eve' })
    await bus.emit('user.created', { id: 2, name: 'Frank' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('once() returns an unsubscribe function', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    const unsub = bus.once('user.created', spy)
    unsub()
    await bus.emit('user.created', { id: 1, name: 'Grace' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not throw when emitting with no listeners', async () => {
    const bus = createEventBus<TestEvents>()
    await expect(bus.emit('post.published', { slug: 'hello' })).resolves.toBeUndefined()
  })

  it('awaits async listeners', async () => {
    const bus = createEventBus<TestEvents>()
    const order: number[] = []
    bus.on('user.created', async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push(1)
    })
    bus.on('user.created', async () => {
      order.push(2)
    })
    await bus.emit('user.created', { id: 1, name: 'Helen' })
    expect(order).toEqual([1, 2])
  })

  it('re-throws listener errors after all listeners run', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    bus.on('user.created', () => { throw new Error('listener error') })
    bus.on('user.created', spy)
    await expect(bus.emit('user.created', { id: 1, name: 'Ivan' })).rejects.toThrow('listener error')
    expect(spy).toHaveBeenCalled() // second listener still ran
  })

  it('does not mix events between different event types', async () => {
    const bus = createEventBus<TestEvents>()
    const spy = vi.fn()
    bus.on('post.published', spy)
    await bus.emit('user.created', { id: 1, name: 'Jane' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('defineEvents', () => {
  it('returns an empty object (runtime no-op)', () => {
    const events = defineEvents<TestEvents>()
    expect(events).toEqual({})
  })
})
