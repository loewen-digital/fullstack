// Config module — Task 1.2
import type { FullstackConfig } from './types.js'

export type { FullstackConfig }

export function defineConfig(config: FullstackConfig): FullstackConfig {
  return config
}

export function loadConfig(): FullstackConfig {
  // TODO: implement in Task 1.2 — reads fullstack.config.ts from project root
  return {}
}
