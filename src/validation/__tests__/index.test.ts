import { describe, it, expect, beforeEach } from 'vitest'
import { validate, defineRules } from '../index.js'
import { clearCustomRules } from '../custom.js'

beforeEach(() => {
  clearCustomRules()
})

describe('validate — string rules', () => {
  it('passes required string field', async () => {
    const result = await validate({ name: 'Alice' }, { name: 'required|string' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe('Alice')
  })

  it('fails required on missing field', async () => {
    const result = await validate({}, { name: 'required|string' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.field).toBe('name')
  })

  it('fails required on empty string', async () => {
    const result = await validate({ name: '' }, { name: 'required' })
    expect(result.ok).toBe(false)
  })

  it('passes optional field when absent', async () => {
    const result = await validate({}, { bio: 'optional|string' })
    expect(result.ok).toBe(true)
  })

  it('passes nullable field when null', async () => {
    const result = await validate({ bio: null }, { bio: 'nullable|string' })
    expect(result.ok).toBe(true)
  })

  it('validates number type', async () => {
    const result = await validate({ age: 'not-a-number' }, { age: 'required|number' })
    expect(result.ok).toBe(false)
  })

  it('passes number type', async () => {
    const result = await validate({ age: 25 }, { age: 'required|number' })
    expect(result.ok).toBe(true)
  })

  it('validates boolean type', async () => {
    const result = await validate({ active: 1 }, { active: 'required|boolean' })
    expect(result.ok).toBe(false)
  })

  it('validates array type', async () => {
    const result = await validate({ tags: 'not-an-array' }, { tags: 'required|array' })
    expect(result.ok).toBe(false)
  })

  it('validates min string length', async () => {
    const result = await validate({ pw: 'abc' }, { pw: 'required|string|min:8' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.rule).toBe('min')
  })

  it('validates max string length', async () => {
    const result = await validate({ name: 'a'.repeat(300) }, { name: 'required|string|max:255' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.rule).toBe('max')
  })

  it('validates email rule', async () => {
    const result = await validate({ email: 'not-an-email' }, { email: 'required|email' })
    expect(result.ok).toBe(false)
  })

  it('passes valid email', async () => {
    const result = await validate({ email: 'user@example.com' }, { email: 'required|email' })
    expect(result.ok).toBe(true)
  })

  it('validates url rule', async () => {
    const result = await validate({ site: 'not-a-url' }, { site: 'required|url' })
    expect(result.ok).toBe(false)
  })

  it('passes valid url', async () => {
    const result = await validate({ site: 'https://example.com' }, { site: 'required|url' })
    expect(result.ok).toBe(true)
  })

  it('validates uuid rule', async () => {
    const result = await validate({ id: 'not-a-uuid' }, { id: 'required|uuid' })
    expect(result.ok).toBe(false)
  })

  it('passes valid uuid', async () => {
    const result = await validate(
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      { id: 'required|uuid' }
    )
    expect(result.ok).toBe(true)
  })

  it('validates in rule', async () => {
    const result = await validate({ role: 'superuser' }, { role: 'required|in:admin,user,guest' })
    expect(result.ok).toBe(false)
  })

  it('passes in rule', async () => {
    const result = await validate({ role: 'admin' }, { role: 'required|in:admin,user,guest' })
    expect(result.ok).toBe(true)
  })

  it('validates regex rule', async () => {
    const result = await validate({ code: 'abc' }, { code: 'required|regex:^[0-9]+$' })
    expect(result.ok).toBe(false)
  })

  it('validates confirmed rule', async () => {
    const result = await validate(
      { password: 'secret', password_confirmation: 'other' },
      { password: 'required|confirmed' }
    )
    expect(result.ok).toBe(false)
  })

  it('passes confirmed rule', async () => {
    const result = await validate(
      { password: 'secret', password_confirmation: 'secret' },
      { password: 'required|confirmed' }
    )
    expect(result.ok).toBe(true)
  })

  it('validates date rule', async () => {
    const result = await validate({ dob: 'not-a-date' }, { dob: 'required|date' })
    expect(result.ok).toBe(false)
  })

  it('validates before rule', async () => {
    const result = await validate({ dob: '2030-01-01' }, { dob: 'required|before:2025-01-01' })
    expect(result.ok).toBe(false)
  })

  it('validates after rule', async () => {
    const result = await validate({ start: '2020-01-01' }, { start: 'required|after:2025-01-01' })
    expect(result.ok).toBe(false)
  })

  it('collects multiple errors', async () => {
    const result = await validate(
      { email: 'bad', name: '' },
      { email: 'required|email', name: 'required|string' }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1)
  })
})

describe('validate — object rules', () => {
  it('passes with object rule format', async () => {
    const result = await validate(
      { name: 'Alice', age: 30 },
      {
        name: { required: true, type: 'string', max: 100 },
        age: { required: true, type: 'number', min: 0 },
      }
    )
    expect(result.ok).toBe(true)
  })

  it('fails type mismatch with object rule', async () => {
    const result = await validate({ age: 'old' }, { age: { required: true, type: 'number' } })
    expect(result.ok).toBe(false)
  })

  it('respects optional in object rule', async () => {
    const result = await validate({}, { bio: { optional: true, type: 'string' } })
    expect(result.ok).toBe(true)
  })

  it('respects nullable in object rule', async () => {
    const result = await validate({ bio: null }, { bio: { nullable: true, type: 'string' } })
    expect(result.ok).toBe(true)
  })

  it('validates in with object rule', async () => {
    const result = await validate(
      { status: 'unknown' },
      { status: { required: true, in: ['active', 'inactive'] } }
    )
    expect(result.ok).toBe(false)
  })

  it('validates regex with RegExp in object rule', async () => {
    const result = await validate(
      { code: 'ABC' },
      { code: { required: true, regex: /^[0-9]+$/ } }
    )
    expect(result.ok).toBe(false)
  })
})

describe('validate — nested fields', () => {
  it('validates nested dot-notation field', async () => {
    const result = await validate(
      { address: { street: '123 Main St' } },
      { 'address.street': 'required|string' }
    )
    expect(result.ok).toBe(true)
  })

  it('fails nested field when missing', async () => {
    const result = await validate(
      { address: {} },
      { 'address.street': 'required|string' }
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]!.field).toBe('address.street')
  })
})

describe('validate — array wildcard', () => {
  it('validates each item in array', async () => {
    const result = await validate(
      { tags: ['js', 'ts', 'node'] },
      { 'tags.*': 'string|max:50' }
    )
    expect(result.ok).toBe(true)
  })

  it('fails when an array item fails rule', async () => {
    const result = await validate(
      { tags: ['js', 123] },
      { 'tags.*': 'string' }
    )
    expect(result.ok).toBe(false)
  })
})

describe('defineRules — custom rules', () => {
  it('registers and runs a custom rule', async () => {
    defineRules([
      {
        name: 'even',
        validate: (value) => typeof value === 'number' && value % 2 === 0,
        message: (field) => `The ${field} field must be an even number.`,
      },
    ])

    const pass = await validate({ count: 4 }, { count: 'required|number|even' })
    expect(pass.ok).toBe(true)

    const fail = await validate({ count: 3 }, { count: 'required|number|even' })
    expect(fail.ok).toBe(false)
    if (!fail.ok) expect(fail.errors[0]!.rule).toBe('even')
  })

  it('supports async custom rules', async () => {
    defineRules([
      {
        name: 'alwaysFail',
        validate: async () => false,
        message: (field) => `${field} always fails.`,
      },
    ])

    const result = await validate({ x: 'anything' }, { x: 'required|alwaysFail' })
    expect(result.ok).toBe(false)
  })
})
