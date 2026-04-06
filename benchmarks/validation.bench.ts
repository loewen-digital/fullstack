/**
 * Benchmarks for the validation module — Task 9.3
 *
 * Run with: npm run bench
 */

import { bench, describe } from 'vitest'
import { validate } from '../src/validation/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const simpleData = { name: 'Alice', email: 'alice@example.com', age: 30 }
const simpleRules = {
  name: 'required|string|max:255',
  email: 'required|email',
  age: 'required|number|min:0|max:150',
}

const nestedData = {
  user: { name: 'Bob', email: 'bob@example.com' },
  address: { street: '123 Main St', city: 'Anytown', zip: '12345' },
  tags: ['ts', 'js', 'node'],
}
const nestedRules = {
  'user.name': 'required|string|max:100',
  'user.email': 'required|email',
  'address.street': 'required|string',
  'address.city': 'required|string',
  'address.zip': 'required|string|regex:^\\d{5}$',
  'tags.*': 'string|max:50',
}

const invalidData = { name: '', email: 'not-an-email', age: -1 }

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('validate — simple schema', () => {
  bench('valid data', async () => {
    await validate(simpleData, simpleRules)
  })

  bench('invalid data (returns errors)', async () => {
    await validate(invalidData, simpleRules)
  })
})

describe('validate — nested schema', () => {
  bench('nested + wildcard array', async () => {
    await validate(nestedData, nestedRules)
  })
})

describe('validate — object rule format', () => {
  bench('object rules (no string parsing)', async () => {
    await validate(simpleData, {
      name: { required: true, type: 'string', max: 255 },
      email: { required: true, email: true },
      age: { required: true, type: 'number', min: 0, max: 150 },
    })
  })
})

describe('parseRuleString — memoization', () => {
  bench('repeated parse of same string (warm cache)', async () => {
    // Calling validate repeatedly with the same rule strings exercises the cache
    await validate(simpleData, simpleRules)
    await validate(simpleData, simpleRules)
    await validate(simpleData, simpleRules)
  })
})
