---
title: Logging
description: Leveled, structured logging with console, file and HTTP transports
---

# Logging

`createLogger` emits entries `{ level, message, timestamp, context }` to one or more transports. The console transport prints colored lines in development and JSON in production; a file transport rotates, an external transport POSTs entries, and a transport is any object with `log(entry)`.

## Import

```ts
import { createLogger } from '@loewen-digital/fullstack/logging'
```

## Basic usage

```ts
import { createLogger } from '@loewen-digital/fullstack/logging'

const logger = createLogger({ level: 'info', context: { service: 'api' } })

logger.info('User logged in', { userId: 42 })
logger.warn('Rate limit approaching', { ip: '1.2.3.4', count: 95 })
logger.error('Payment failed', { orderId: 'ord_123', reason: 'insufficient_funds' })
```

`context` from the config is merged into every entry, the call's context on top.

## Levels

`debug`, `info`, `warn`, `error`, `fatal`, in that order. The configured level and everything above it is emitted; the default is `debug`.

| Level | Use for |
|---|---|
| `debug` | development diagnostics |
| `info` | normal application events |
| `warn` | recoverable issues worth noting |
| `error` | failures that need attention |
| `fatal` | the process cannot go on |

## Child loggers

`child(context)` returns a logger that adds the context to every entry it emits; children nest.

```ts
const requestLogger = logger.child({ requestId: 'req_abc', userId: 7 })
requestLogger.info('Processing payment') // context: { service, requestId, userId }
```

## Transports

`transports` replaces the default console transport; list the ones you want. A transport's `log` may be async; its errors are swallowed so logging never crashes the app.

```ts
import { createLogger, consoleTransport, fileTransport, externalTransport } from '@loewen-digital/fullstack/logging'

const production = createLogger({
  level: 'info',
  transports: [
    consoleTransport('prod'), // one JSON object per line
    fileTransport({ path: './logs/app.log', maxSize: 10 * 1024 * 1024, maxFiles: 5 }),
    externalTransport({ url: 'https://logs.example.com/ingest', headers: { authorization: 'Bearer ...' }, level: 'error' }),
  ],
})
```

| Transport | Options | Behaviour |
|---|---|---|
| `consoleTransport(format?)` | `'dev'` or `'prod'`; without it `dev` unless `NODE_ENV` is `production` | `dev`: `HH:MM:SS.mmm LEVEL message {context}` in color; `prod`: JSON. `error` and `fatal` go to `console.error`, `warn` to `console.warn`. In development entries also appear in the [Dev UI](/tooling/dev-ui) |
| `fileTransport({ path, maxSize?, maxFiles? })` | rotate at `maxSize` bytes (10 MB), keep `maxFiles` (5) rotated files | Node only; one JSON object per line |
| `externalTransport({ url, headers?, level? })` | forwards `level` (default `error`) and above | one `POST` per entry, JSON body, fire and forget |

A custom transport:

```ts
import type { LogTransport } from '@loewen-digital/fullstack/logging'

const inMemory: LogTransport & { entries: string[] } = {
  entries: [],
  log(entry) {
    this.entries.push(`${entry.level}: ${entry.message}`)
  },
}

const testLogger = createLogger({ transports: [inMemory] })
```

## Config options

`createLogger(config)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `level` | `LogLevel` | `'debug'` | Minimum level emitted |
| `transports` | `LogTransport[]` | `[consoleTransport(format)]` | Where entries go |
| `format` | `'dev' \| 'prod'` | from `NODE_ENV` | Format of the default console transport |
| `context` | `Record<string, unknown>` | `{}` | Merged into every entry |
