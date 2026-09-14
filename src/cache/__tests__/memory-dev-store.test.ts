import { describe, it, expect } from 'vitest'
import { createMemoryDriver } from '../drivers/memory.js'
import { devStoreClearAll, devStoreGetCacheEntries, isDevMode } from '../../dev-store/index.js'

describe('memory driver and the dev store', () => {
  it('adds no process listeners, however many caches an app builds', () => {
    const before = process.listenerCount('exit')
    for (let i = 0; i < 20; i++) createMemoryDriver()
    expect(process.listenerCount('exit')).toBe(before)
  })

  it('lists the entries of a live cache in dev mode', async () => {
    expect(isDevMode()).toBe(true) // vitest runs without NODE_ENV=production
    devStoreClearAll()
    const driver = createMemoryDriver()
    await driver.set('greeting', 'hello')
    expect(devStoreGetCacheEntries()).toEqual([{ key: 'greeting', value: 'hello', expiresAt: null }])
    devStoreClearAll()
  })
})
