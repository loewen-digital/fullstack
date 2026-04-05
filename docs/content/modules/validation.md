---
title: Validation
description: Stateless, rule-based input validation for any data source
---

# Validation

The validation module provides stateless, rule-based input validation. It works with any plain object — form data, JSON bodies, URL params — and returns a typed result you can inspect without throwing exceptions.

## Import

```ts
import { validate, defineRules } from '@loewen-digital/fullstack/validation'
```

## Basic usage

```ts
import { validate } from '@loewen-digital/fullstack/validation'

const result = validate(
  { email: 'alice@example.com', password: 'secret123' },
  {
    email: ['required', 'email'],
    password: ['required', 'min:8'],
  }
)

if (!result.passes) {
  console.log(result.errors)
  // { password: ['The password must be at least 8 characters.'] }
}

// result.data is the validated (and trimmed) input
console.log(result.data.email) // 'alice@example.com'
```

## Working with FormData

```ts
const formData = await request.formData()

const result = validate(Object.fromEntries(formData), {
  username: ['required', 'string', 'min:3', 'max:32'],
  email: ['required', 'email'],
  age: ['required', 'numeric', 'min:18'],
})
```

## Available rules

| Rule | Description |
|---|---|
| `required` | Field must be present and non-empty |
| `string` | Must be a string |
| `numeric` | Must be a number or numeric string |
| `boolean` | Must be a boolean-like value |
| `email` | Must be a valid email address |
| `url` | Must be a valid URL |
| `min:n` | Minimum length (strings) or value (numbers) |
| `max:n` | Maximum length (strings) or value (numbers) |
| `between:min,max` | Value must be between min and max |
| `in:a,b,c` | Value must be one of the listed options |
| `not_in:a,b,c` | Value must not be one of the listed options |
| `regex:/pattern/` | Must match the given regular expression |
| `confirmed` | Field must have a matching `_confirmation` field |
| `nullable` | Field may be null or absent |
| `array` | Must be an array |
| `date` | Must be a parseable date string |

## Custom rules

```ts
import { defineRules, validate } from '@loewen-digital/fullstack/validation'

const rules = defineRules({
  slug: (value) => {
    if (!/^[a-z0-9-]+$/.test(String(value))) {
      return 'The :attribute may only contain lowercase letters, numbers, and hyphens.'
    }
  },
})

const result = validate({ slug: 'Hello World' }, { slug: ['required', 'slug'] }, { rules })
```

## Config options

`validate()` accepts an optional third argument:

| Option | Type | Default | Description |
|---|---|---|---|
| `rules` | `Record<string, RuleFn>` | `{}` | Custom rule definitions |
| `messages` | `Record<string, string>` | `{}` | Custom error message overrides |
| `bail` | `boolean` | `false` | Stop after the first failure per field |
