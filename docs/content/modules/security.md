---
title: Security
description: CSRF protection, CORS, rate limiting, and input sanitization
---

# Security

The `security` module bundles several common HTTP security primitives: CSRF token generation and validation, CORS header management, rate limiting, and HTML input sanitization.

## Import

```ts
import { createSecurity } from '@loewen-digital/fullstack/security'
```

## Basic usage

```ts
import { createSecurity } from '@loewen-digital/fullstack/security'

const security = createSecurity({
  csrf: { secret: process.env.CSRF_SECRET! },
  cors: {
    origin: ['https://example.com', 'https://app.example.com'],
    credentials: true,
  },
  rateLimit: {
    windowMs: 60_000,
    max: 100,
  },
})
```

## CSRF protection

```ts
// Generate a token (embed in your HTML form)
const token = await security.csrf.token(request)

// Verify the token from an incoming POST
const valid = await security.csrf.verify(request)
if (!valid) {
  return new Response('Forbidden', { status: 403 })
}
```

## CORS

```ts
// Apply CORS headers to a response
const response = security.cors.apply(request, new Response('OK'))

// Handle preflight requests
if (request.method === 'OPTIONS') {
  return security.cors.preflight(request)
}
```

## Rate limiting

```ts
// Check if the current request is within the rate limit
const result = await security.rateLimit.check(request)

if (result.exceeded) {
  return new Response('Too Many Requests', {
    status: 429,
    headers: { 'Retry-After': String(result.retryAfter) },
  })
}
```

## Input sanitization

```ts
// Strip HTML tags from untrusted input
const clean = security.sanitize.stripTags(userInput)

// Escape HTML entities
const escaped = security.sanitize.escape(userInput)

// Allow a specific subset of HTML tags
const allowed = security.sanitize.allowTags(userInput, ['b', 'i', 'a', 'p'])
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `csrf.secret` | `string` | — | Secret for CSRF token signing |
| `csrf.cookieName` | `string` | `'csrf_token'` | Cookie name for the CSRF token |
| `cors.origin` | `string \| string[] \| '*'` | `'*'` | Allowed origins |
| `cors.methods` | `string[]` | common verbs | Allowed HTTP methods |
| `cors.credentials` | `boolean` | `false` | Allow credentials |
| `rateLimit.windowMs` | `number` | `60000` | Rate limit window in milliseconds |
| `rateLimit.max` | `number` | `100` | Maximum requests per window |
| `rateLimit.keyBy` | `(req) => string` | client IP | Key function for rate limit buckets |
