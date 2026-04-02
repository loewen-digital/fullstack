import { describe, it, expect } from 'vitest'
import { resolveDriver } from '../drivers.js'

describe('resolveDriver()', () => {
  it('resolves a driver by name (default export)', async () => {
    const mockDriver = { get: () => 'ok' }
    const driver = await resolveDriver('memory', {
      memory: async () => ({ default: mockDriver }),
    })
    expect(driver).toBe(mockDriver)
  })

  it('resolves a driver by name (named export only — no default)', async () => {
    const mockDriver = { get: () => 'ok' }
    const driver = await resolveDriver('memory', {
      memory: async () => mockDriver as unknown as { default: typeof mockDriver },
    })
    expect(driver).toBe(mockDriver)
  })

  it('throws for unknown driver names', async () => {
    await expect(
      resolveDriver('unknown', {
        memory: async () => ({ default: {} as never }),
        redis: async () => ({ default: {} as never }),
      }),
    ).rejects.toThrow('Unknown driver "unknown". Available drivers: memory, redis')
  })
})
