import { createDb } from '../db/index.js'
import { loadConfig } from '../config/index.js'
import type { DbConfig } from '../config/types.js'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function getDbConfig(config: { db?: DbConfig }): DbConfig {
  if (!config.db) {
    console.error('Error: No "db" config found in fullstack.config.ts')
    process.exit(1)
  }
  return config.db
}

export async function seedRun(file?: string): Promise<void> {
  const config = await loadConfig()
  const dbConfig = getDbConfig(config)
  const db = createDb(dbConfig)

  try {
    const seedPath = file
      ? resolve(process.cwd(), file)
      : resolve(process.cwd(), 'database', 'seeds', 'index.ts')

    const jsSeedPath = seedPath.replace(/\.ts$/, '.js')
    const resolvedPath = existsSync(jsSeedPath)
      ? jsSeedPath
      : existsSync(seedPath)
        ? seedPath
        : null

    if (!resolvedPath) {
      console.error(`Error: Seed file not found. Tried:\n  ${jsSeedPath}\n  ${seedPath}`)
      process.exit(1)
    }

    console.log(`Running seed: ${resolvedPath}`)
    const mod = await import(resolvedPath) as { default?: (db: typeof db) => Promise<void>; seed?: (db: typeof db) => Promise<void> }
    const seedFn = mod.default ?? mod.seed

    if (typeof seedFn !== 'function') {
      console.error('Error: Seed file must export a default function or a named "seed" function.')
      process.exit(1)
    }

    await db.seed(seedFn)
    console.log('Seeding complete.')
  } finally {
    db.close()
  }
}
