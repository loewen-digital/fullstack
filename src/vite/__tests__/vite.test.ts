import { describe, it, expect } from 'vitest'
import { fullstackPlugin } from '../index.js'

describe('fullstackPlugin', () => {
  it('returns a Vite plugin object with the correct name', () => {
    const plugin = fullstackPlugin()
    expect(plugin.name).toBe('vite-plugin-fullstack')
  })

  it('resolves virtual:fullstack/config module id', () => {
    const plugin = fullstackPlugin()
    const resolveId = plugin.resolveId as (id: string) => string | undefined
    expect(resolveId('virtual:fullstack/config')).toBe('\0virtual:fullstack/config')
    expect(resolveId('something-else')).toBeUndefined()
  })

  it('loads virtual config module with empty config initially', () => {
    const plugin = fullstackPlugin()
    const load = plugin.load as (id: string) => string | undefined
    const result = load('\0virtual:fullstack/config')
    expect(result).toContain('export default')
    // Should be valid JSON after the `export default `
    const json = result?.replace('export default ', '') ?? '{}'
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('returns undefined for unknown virtual modules', () => {
    const plugin = fullstackPlugin()
    const load = plugin.load as (id: string) => string | undefined
    expect(load('some-other-module')).toBeUndefined()
  })

  it('accepts custom options', () => {
    const plugin = fullstackPlugin({ configFile: './custom.config.ts' })
    expect(plugin.name).toBe('vite-plugin-fullstack')
  })
})
