---
title: Vite Plugin
description: fullstackPlugin loads fullstack.config.ts, exposes it as a virtual module and serves the Dev UI in development
---

# Vite Plugin

`fullstackPlugin()` does three things: it loads `fullstack.config.ts` from the project root and exposes it as the virtual module `virtual:fullstack/config` (with a generated `fullstack.d.ts` so the import is typed), it reloads when that file changes, and in `vite dev` it mounts the [Dev UI](/tooling/dev-ui) at `/__fullstack/`. SvelteKit runs on Vite, so the plugin goes next to `sveltekit()`.

## Import

```ts
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'
```

## Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'

export default defineConfig({
  plugins: [sveltekit(), fullstackPlugin()],
})
```

The config file is `fullstack.config.ts` (or `.js`) in the Vite root, a default export of `defineConfig`. Without one the config is `{}`.

```ts
// fullstack.config.ts
import { defineConfig } from '@loewen-digital/fullstack'

export default defineConfig({
  db: { driver: 'sqlite', url: './app.db', migrations: './drizzle' },
  cache: { driver: 'memory', ttl: '10m' },
})
```

The same file is what the [CLI](/tooling/cli) reads for `migrate` and `seed`.

## The virtual module

`virtual:fullstack/config` is the loaded config as a default export, serialized to JSON at build time. `fullstack.d.ts` in the root declares it (the plugin writes the file on every build and config change; commit it or ignore it, it is regenerated):

```ts
// fullstack.d.ts
declare module 'virtual:fullstack/config' {
  import type { FullstackConfig } from '@loewen-digital/fullstack/config'
  const config: FullstackConfig
  export default config
}
```

```ts
// src/lib/server/stack.ts
import config from 'virtual:fullstack/config'
import { createStack } from '@loewen-digital/fullstack'

export const stack = createStack(config)
```

The module is inlined wherever it is imported, client code included. Keep secrets out of `fullstack.config.ts`, or import the module only from server files; read secrets from the environment where the stack is built.

## Reloading

In `vite dev` the plugin watches the config file. A change reloads it, rewrites `fullstack.d.ts`, invalidates the virtual module and triggers a full page reload.

## Dev UI

`configureServer` runs only for the dev server, so the Dev UI and its API under `/__fullstack/` exist in `vite dev` and in nothing else: a production build carries no route, no HTML and no store. The panels read the in-memory dev store that the console mail driver, the memory queue driver, the console log transport and the memory cache driver fill while `NODE_ENV` is not `production`.

## Config options

`fullstackPlugin(options)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `configRoot` | `string` | Vite's `root` | Directory that holds `fullstack.config.ts` |
| `generateTypes` | `boolean` | `true` | Write `fullstack.d.ts` with the virtual module's declaration on build and on config change |

There is no option for the Dev UI or its path: it is on in `vite dev` at `/__fullstack/`, off everywhere else.
