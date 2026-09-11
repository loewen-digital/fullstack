---
title: Validation
description: Stateless, rule-based validation of plain objects with typed results
---

# Validation

`validate(data, rules)` checks a plain object (form data, a JSON body, query params) against rules and returns a result instead of throwing: `{ ok: true, data }` with the validated fields, or `{ ok: false, errors }` with one entry per failed rule. It holds no state and needs no setup; the framework adapters' `validateForm`/`validateBody` call it for you.

## Import

```ts
import { validate, defineRules } from '@loewen-digital/fullstack/validation'
```

## Basic usage

Rules are pipe strings; the call is async because custom rules may be.

```ts
import { validate } from '@loewen-digital/fullstack/validation'

async function login(input: Record<string, unknown>) {
  const result = await validate(input, {
    email: 'required|email',
    password: 'required|string|min:8',
  })

  if (!result.ok) {
    return result.errors // [{ field: 'password', rule: 'min', message: 'The password field must be at least 8 characters.' }]
  }

  return result.data // { email: string; password: string }
}
```

`data` contains only the fields the rules name, and only those that were present. `errors` is an array of `{ field, rule, message }`; a field with two failing rules has two entries.

## Form data

Form values are strings. `string`, `email`, `regex`, `in` and the length rules work on them as they are; `number` and `boolean` check the JavaScript type, so convert first or validate the string with `regex`.

```ts
async function fromForm(request: Request) {
  const form = await request.formData()
  return validate(Object.fromEntries(form), {
    username: 'required|string|min:3|max:32',
    email: 'required|email',
    age: 'required|regex:^[0-9]+$',
  })
}
```

## Rules

| Rule | Passes when |
|---|---|
| `required` | the value is not `undefined`, `null` or `''` |
| `optional` | skips every other rule when the value is `undefined`, `null` or `''` |
| `nullable` | skips every other rule when the value is `null` |
| `string`, `number`, `boolean`, `array`, `object` | the value has that JavaScript type (`null`/`undefined` pass; combine with `required`) |
| `min:n`, `max:n` | length of a string, value of a number, item count of an array |
| `email`, `url`, `uuid` | the string matches the format (`url` needs `http` or `https`) |
| `date` | `new Date(value)` is valid |
| `before:date`, `after:date` | the value is a date before/after the parameter (any `Date` input) |
| `in:a,b,c` | `String(value)` is one of the listed options |
| `regex:pattern` | the string matches the pattern (everything after the first colon) |
| `confirmed` | `data[field + '_confirmation']` equals the value |

Rules on nested fields use dot notation (`'address.street': 'required|string'`); `'tags.*': 'string'` validates every item of an array. `optional` and `nullable` are read from the whole string, not by position.

## Object rules

The same rules as an object, for rules built at runtime or a regex that contains a pipe. `required` is on unless `required: false` or `optional: true`.

```ts
const result = await validate(
  { name: 'Alice', role: 'admin', website: null },
  {
    name: { type: 'string', min: 2, max: 50 },
    role: { in: ['admin', 'editor', 'viewer'] },
    website: { nullable: true, url: true },
    slug: { optional: true, regex: /^[a-z0-9-]+$/ },
  },
)
```

## Inferred types

`result.data` is typed from the rules: a rule string or object with `number`, `boolean`, `array` or `object` gives that type, everything else is `string`; `nullable` adds `null`, `optional` makes the key optional.

```ts
async function inferred(input: Record<string, unknown>) {
  const result = await validate(input, { title: 'required|string', pages: 'required|number', isbn: 'optional|string' })
  if (result.ok) {
    const { title, pages, isbn } = result.data // string, number, string | undefined
    return { title, pages, isbn }
  }
  return null
}
```

## Custom rules

`defineRules` registers rules by name in a global registry; from then on any rule string can use them. `validate` may be async; `message` gets the field name and the parameter.

```ts
import { defineRules } from '@loewen-digital/fullstack/validation'

defineRules([
  {
    name: 'slug',
    validate: (value) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value),
    message: (field) => `The ${field} field may only contain lowercase letters, numbers and hyphens.`,
  },
  {
    name: 'unique',
    validate: async (value, param) => !(await existsIn(String(param), value)),
    message: (field, param) => `The ${field} field is already taken in ${param}.`,
  },
])

async function existsIn(table: string, value: unknown): Promise<boolean> {
  return table === 'users' && value === 'taken' // your lookup
}

async function createPost(input: Record<string, unknown>) {
  return validate(input, { slug: 'required|slug|unique:posts' })
}
```

## Errors as a response

`ValidationError` from `@loewen-digital/fullstack/errors` takes the messages grouped by field and becomes a 422 response through `errorToResponse`; the framework adapters flash the entries into the session instead.

```ts
import { ValidationError, errorToResponse } from '@loewen-digital/fullstack/errors'

async function handle(input: Record<string, unknown>): Promise<Response> {
  const result = await validate(input, { email: 'required|email' })
  if (!result.ok) {
    const byField: Record<string, string[]> = {}
    for (const { field, message } of result.errors) (byField[field] ??= []).push(message)
    return errorToResponse(new ValidationError(byField))
  }
  return Response.json(result.data)
}
```

## Options

`validate(data, rules)` takes no third argument: messages are fixed English strings built from the field name, every rule of a field runs, and custom rules come from `defineRules`.
