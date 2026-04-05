import { describe, it, expect } from 'vitest'
import { fullstackPlugin } from '../index.js'

describe('fullstackPlugin', () => {
  it('returns a Vite plugin object with the correct name', () => {
    const plugin = fullstackPlugin()
    expect(plugin.name).toBe('vite-plugin-fullstack')
  })

  it('enforces pre execution order', () => {
    const plugin = fullstackPlugin()
    expect(plugin.enforce).toBe('pre')
  })

  it('resolves virtual:fullstack/config module id', () => {
    const plugin = fullstackPlugin()
    const resolveId = plugin.resolveId as (id: string) => string | undefined
    expect(resolveId('virtual:fullstack/config')).toBe('\0virtual:fullstack/config')
    expect(resolveId('something-else')).toBeUndefined()
  })

  it('loads virtual config module as a valid JS export', () => {
    const plugin = fullstackPlugin()
    const load = plugin.load as (id: string) => string | undefined
    const result = load('\0virtual:fullstack/config')
    expect(result).toMatch(/^export default /)
    const json = result!.replace('export default ', '')
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('returns undefined for unknown virtual modules', () => {
    const plugin = fullstackPlugin()
    const load = plugin.load as (id: string) => string | undefined
    expect(load('some-other-module')).toBeUndefined()
  })

  it('accepts generateTypes option', () => {
    const plugin = fullstackPlugin({ generateTypes: false })
    expect(plugin.name).toBe('vite-plugin-fullstack')
  })

  it('accepts configRoot option', () => {
    const plugin = fullstackPlugin({ configRoot: '/tmp' })
    expect(plugin.name).toBe('vite-plugin-fullstack')
  })

  it('has configureServer hook', () => {
    const plugin = fullstackPlugin()
    expect(typeof plugin.configureServer).toBe('function')
  })

  it('has buildStart hook', () => {
    const plugin = fullstackPlugin()
    expect(typeof plugin.buildStart).toBe('function')
  })
})
