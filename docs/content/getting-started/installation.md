---
title: Installation
description: How to install @loewen-digital/fullstack in your project
---

# Installation

## Requirements

- Node.js 24 (`engines.node` in the package), or a runtime with the Web Platform APIs: Bun, Deno, Cloudflare Workers with `nodejs_compat`
- npm; the package ships ESM only, there is no CJS build
- TypeScript 5 or later

## Install the package

```bash
npm install @loewen-digital/fullstack
```

That is the only dependency for most modules. `drizzle-orm` and `better-sqlite3` come with it for the `db` module; everything else talks HTTP through `fetch` or takes a client you hand it.

## Optional packages

Install only what the driver you use needs:

```bash
# auth on flatdb collections (see the Auth on flatdb guide)
npm install @loewen-digital/flatdb zod

# SMTP mail driver
npm install nodemailer

# Redis drivers for cache, session and queue: any client with the ioredis / node-redis v4 methods
npm install ioredis

# Types for Cloudflare bindings (KV, R2, Queues)
npm install -D @cloudflare/workers-types
```

Resend, Postmark, S3, R2, Meilisearch and Typesense are reached through `fetch`; no SDK is needed.

## TypeScript setup

Every internal import carries a `.js` extension, so `moduleResolution` has to be `bundler`, `node16` or `nodenext`. SvelteKit, Vite and the other meta-frameworks set this already.

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

`validate` needs no setup and no I/O: rules are pipe strings, the call is async, the result is `{ ok: true, data }` or `{ ok: false, errors }`.

```ts
import { validate } from '@loewen-digital/fullstack/validation'

async function check() {
  const result = await validate({ name: 'Alice' }, { name: 'required|string' })
  console.log(result.ok) // true
}
```

If this compiles and runs, head to the [Quick Start](/getting-started/quick-start) and build a login.
