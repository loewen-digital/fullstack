---
title: Dev UI
description: Browser-based development panel for inspecting mail, queue, cache, and logs
---

# Dev UI

The Dev UI is a browser-based development panel embedded via the Vite plugin. It gives you visibility into what your application is doing — without `console.log` or external dashboards.

## Enabling the Dev UI

Add the Vite plugin with `devUI: true`:

```ts
// vite.config.ts
import { fullstack } from '@loewen-digital/fullstack/vite'

export default {
  plugins: [
    fullstack({ devUI: true }),
  ],
}
```

Then visit `http://localhost:5173/_fullstack` while your dev server is running.

## Mail preview

The mail panel shows every email sent through the `console` driver during the current session:

- Full message preview with HTML rendering
- Headers, recipients, subject, and body
- One-click resend to a real address for manual testing

Configure the `console` driver in development:

```ts
const mail = createMail({
  driver: process.env.NODE_ENV === 'production' ? 'resend' : 'console',
  from: { name: 'My App', address: 'hello@example.com' },
})
```

## Queue inspector

The queue panel shows the state of all jobs in your in-memory or database queue:

- **Pending** — jobs waiting to be processed
- **Processing** — jobs currently being handled
- **Completed** — recently finished jobs with execution time
- **Failed** — jobs that threw an error, with stack traces

You can retry failed jobs and clear queues directly from the UI.

## Cache explorer

Browse all cache keys and their current values. Useful for verifying that caching is working as expected and for manually invalidating entries during development.

## Session viewer

Inspect the session contents for any authenticated user. Useful for debugging session-based auth flows, flash messages, and old input.

## Log viewer

A live-tailing log viewer that displays structured log entries from the `console` logger. Supports filtering by level (debug, info, warn, error) and free-text search.

## Production safety

The Dev UI is completely excluded from production builds. The Vite plugin detects `NODE_ENV=production` and omits all Dev UI routes and assets. There is no runtime cost in production.
