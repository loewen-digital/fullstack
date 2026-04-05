---
title: Vite Plugin
description: Vite integration for development utilities and the Dev UI
---

# Vite Plugin

The `@loewen-digital/fullstack` Vite plugin adds development tooling to your build: the Dev UI panel, virtual module support, and hot-reload awareness for configuration changes.

## Import

```ts
import { fullstack } from '@loewen-digital/fullstack/vite'
```

## Setup

Add the plugin to your `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { fullstack } from '@loewen-digital/fullstack/vite'

export default defineConfig({
  plugins: [
    sveltekit(),
    fullstack({
      // Enable the Dev UI at /_fullstack
      devUI: true,
    }),
  ],
})
```

## Features

### Dev UI

When `devUI: true`, the plugin mounts a development panel at `/_fullstack` (in `dev` mode only). The Dev UI provides:

- **Mail preview** — view all emails sent via the `console` driver in a browser
- **Queue inspector** — view pending, processing, and failed jobs
- **Cache explorer** — inspect cache keys and values
- **Session viewer** — debug session contents for the current user
- **Log viewer** — tail structured logs in real time

The Dev UI is never included in production builds.

### Configuration hot-reload

When your `fullstack.config.ts` changes, the plugin triggers a module reload without requiring a full server restart.

### Type generation

The plugin can generate TypeScript types from your database schema and route configuration:

```ts
fullstack({
  devUI: true,
  generateTypes: true, // writes to src/fullstack.d.ts
})
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `devUI` | `boolean` | `false` | Enable the Dev UI panel in development |
| `devUI.path` | `string` | `'/_fullstack'` | URL path for the Dev UI |
| `generateTypes` | `boolean` | `false` | Auto-generate TypeScript types from schema |
| `configFile` | `string` | `'fullstack.config'` | Path to the stack config file |
