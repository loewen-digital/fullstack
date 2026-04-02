import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env } from '../env.js'

describe('env()', () => {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original }
  })

  afterEach(() => {
    process.env = original
  })

  it('returns string value when variable is set', () => {
    process.env['APP_NAME'] = 'fullstack'
    expect(env('APP_NAME')).toBe('fullstack')
  })

  it('throws when required variable is missing', () => {
    delete process.env['MISSING_VAR']
    expect(() => env('MISSING_VAR')).toThrow('Missing required environment variable: MISSING_VAR')
  })

  it('returns string fallback when variable is missing', () => {
    delete process.env['PORT']
    expect(env('PORT', '3000')).toBe('3000')
  })

  it('returns string from env over fallback', () => {
    process.env['PORT'] = '4000'
    expect(env('PORT', '3000')).toBe('4000')
  })

  it('parses number when fallback is number', () => {
    process.env['MAX_CONN'] = '10'
    expect(env('MAX_CONN', 5)).toBe(10)
  })

  it('returns number fallback when variable is missing', () => {
    delete process.env['MAX_CONN']
    expect(env('MAX_CONN', 5)).toBe(5)
  })

  it('throws when variable cannot be parsed as number', () => {
    process.env['MAX_CONN'] = 'abc'
    expect(() => env('MAX_CONN', 0)).toThrow('must be a number')
  })

  it('parses boolean true variants', () => {
    for (const val of ['true', 'True', 'TRUE', '1']) {
      process.env['FLAG'] = val
      expect(env('FLAG', false)).toBe(true)
    }
  })

  it('parses boolean false variants', () => {
    for (const val of ['false', 'False', 'FALSE', '0']) {
      process.env['FLAG'] = val
      expect(env('FLAG', true)).toBe(false)
    }
  })

  it('returns boolean fallback when variable is missing', () => {
    delete process.env['DEBUG']
    expect(env('DEBUG', false)).toBe(false)
  })

  it('throws when variable cannot be parsed as boolean', () => {
    process.env['DEBUG'] = 'yes'
    expect(() => env('DEBUG', false)).toThrow('must be a boolean')
  })
})
