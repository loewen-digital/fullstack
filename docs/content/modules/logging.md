---
title: Logging
description: Structured, leveled logging with pluggable transports
---

# Logging

The logging module provides structured, leveled logging with pluggable transports. Log entries are plain objects — easy to forward to any log aggregation service.

## Import

```ts
import { createLogger } from '@loewen-digital/fullstack/logging'
```

## Basic usage

```ts
import { createLogger } from '@loewen-digital/fullstack/logging'

const logger = createLogger({ driver: 'console', level: 'info' })

logger.info('User logged in', { userId: 42 })
logger.warn('Rate limit approaching', { ip: '1.2.3.4', count: 95 })
logger.error('Payment failed', { orderId: 'ord_123', reason: 'insufficient_funds' })
```

## Log levels

Levels follow the standard severity hierarchy. A configured level only emits that level and above.

| Level | Use for |
|---|---|
| `debug` | Detailed development diagnostics |
| `info` | Normal application events |
| `warn` | Recoverable issues worth noting |
| `error` | Failures that need attention |
| `fatal` | Unrecoverable errors |

## Child loggers

Create a child logger with pre-set context fields:

```ts
const requestLogger = logger.child({ requestId: 'req_abc', userId: 7 })
requestLogger.info('Processing payment') // includes requestId and userId automatically
```

## Driver options

| Driver | Description |
|---|---|
| `console` | Pretty-prints to stdout. Default for development. |
| `file` | Appends newline-delimited JSON to a log file. |
| `http` | POSTs log batches to an HTTP endpoint (Logtail, Axiom, etc.). |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'console' \| 'file' \| 'http'` | `'console'` | Transport driver |
| `level` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | `'info'` | Minimum log level |
| `file.path` | `string` | — | Path to log file (file driver) |
| `http.url` | `string` | — | Endpoint URL (http driver) |
| `http.headers` | `Record<string, string>` | `{}` | Additional request headers |
