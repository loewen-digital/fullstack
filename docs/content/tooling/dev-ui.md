---
title: Dev UI
description: The panel at /__fullstack/ shows mail, jobs, logs, cache and the loaded config while vite dev runs
---

# Dev UI

The Dev UI is a single page the [Vite plugin](/tooling/vite-plugin) serves at `/__fullstack/` while `vite dev` runs. It shows what the in-memory drivers did in the current process: mail from the console driver, jobs from the memory queue driver, entries from the console log transport, the memory cache's keys, and the config the plugin loaded. Nothing is configured; nothing of it is in a production build.

## Opening it

With `fullstackPlugin()` in `vite.config.ts`, start the dev server and open `http://localhost:5173/__fullstack/`. The page polls its API every few seconds.

## Where the data comes from

The drivers write to a dev store while `NODE_ENV` is not `production`; the store keeps the last 500 entries of each kind and lives in the dev server's process.

| Panel | Source | Shows |
|---|---|---|
| Overview | all stores | counts of mails, jobs and log entries |
| Mail | `createMail({ driver: 'console' })` | every message sent: from, to, cc, bcc, subject, text and HTML |
| Queue | `createQueue({ driver: 'memory' })` | every job with its status (`pending`, `processing`, `completed`, `failed`), attempts and the failure reason |
| Logs | `consoleTransport()` of `createLogger` | level, message, timestamp and context of every entry |
| Cache | `createCache({ driver: 'memory' })` | key, value and expiry of every live entry |
| Config | the plugin | the loaded `fullstack.config.ts` as JSON |

Mail, jobs and logs can be cleared from their panel. A driver with a service behind it (Resend, Redis, a file transport) does not report here; keep the console and memory drivers in development.

```ts
import { createMail } from '@loewen-digital/fullstack/mail'
import { createLogger } from '@loewen-digital/fullstack/logging'

export const mail = createMail({ driver: 'console', from: 'My App <hello@example.com>' }) // every send shows in Mail
export const logger = createLogger({ level: 'debug' }) // the default console transport feeds Logs
```

## The API

The page reads `GET /__fullstack/api/mail`, `/queue`, `/logs`, `/cache` and `/config`, and clears with `POST /__fullstack/api/mail/clear`, `/queue/clear` and `/logs/clear`. They return JSON and are as reachable as the dev server is; the same is true of the config, so keep secrets out of `fullstack.config.ts`.

## Not in the Dev UI

There is no session viewer, no resend of a mail, and no retry of a failed job from the page; `queue.retry(id)` in code does the last one. In a production build the plugin registers no middleware and the drivers skip the store, so the UI costs nothing there.
