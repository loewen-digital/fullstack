---
title: Installation
description: How to install @loewen-digital/fullstack in your project
---

# Installation

## Requirements

- Node.js 20 or later
- npm (the package ships ESM only — no CJS build)
- TypeScript 5+ recommended

## Install the package

```bash
npm install @loewen-digital/fullstack
```

That's the only required dependency. Driver-specific peer dependencies (Redis client, AWS SDK, etc.) are optional and only needed when you use those drivers.

## Optional peer dependencies

Install only what you need:

```bash
# Redis (for session, cache, or queue drivers)
npm install ioredis

# S3 / R2 storage
npm install @aws-sdk/client-s3

# Resend email
npm install resend

# Postmark email
npm install postmark

# Meilisearch
npm install meilisearch

# Typesense
npm install typesense
```

## TypeScript setup

The package requires `"moduleResolution": "bundler"` or `"node16"` / `"nodenext"` in your `tsconfig.json` because all internal imports use `.js` extensions (ESM standard).

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

## Verify the installation

```ts
import { validate } from '@loewen-digital/fullstack/validation'

const result = validate({ name: 'Alice' }, { name: ['required', 'string'] })
console.log(result.passes) // true
```

If this compiles and runs without errors, you're good to go. Head to the [Quick Start](/getting-started/quick-start) to build something real.
