import { describe, it, expect } from 'vitest'
import { defineConfig } from '../index.js'

describe('defineConfig()', () => {
  it('returns the config unchanged', () => {
    const config = defineConfig({ db: { driver: 'sqlite', url: ':memory:' } })
    expect(config).toEqual({ db: { driver: 'sqlite', url: ':memory:' } })
  })

  it('accepts empty config', () => {
    expect(defineConfig({})).toEqual({})
  })
})
