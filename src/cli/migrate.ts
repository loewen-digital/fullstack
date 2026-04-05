import { createDb } from '../db/index.js'
import { loadConfig } from '../config/index.js'
import type { DbConfig } from '../config/types.js'

function getDbConfig(config: { db?: DbConfig }): DbConfig {
  if (!config.db) {
    console.error('Error: No "db" config found in fullstack.config.ts')
    process.exit(1)
  }
  return config.db
}

export async function migrateRun(folder?: string): Promise<void> {
  const config = await loadConfig()
  const dbConfig = getDbConfig(config)
  const db = createDb(dbConfig)
  try {
    console.log('Running migrations...')
    await db.migrate(folder)
    console.log('Migrations complete.')
  } finally {
    db.close()
  }
}

export async function migrateRollback(): Promise<void> {
  const config = await loadConfig()
  const dbConfig = getDbConfig(config)
  const db = createDb(dbConfig)
  try {
    console.log('Rolling back last migration...')
    await db.rollback()
    console.log('Rollback complete.')
  } finally {
    db.close()
  }
}

export async function migrateStatus(): Promise<void> {
  const config = await loadConfig()
  const dbConfig = getDbConfig(config)
  const db = createDb(dbConfig)
  try {
    const statuses = await db.migrationStatus()
    if (statuses.length === 0) {
      console.log('No migrations have been applied.')
      return
    }
    console.log('Applied migrations:')
    for (const s of statuses) {
      const appliedAt = s.appliedAt ? ` (applied ${s.appliedAt.toISOString()})` : ''
      console.log(`  ✓ ${s.name}${appliedAt}`)
    }
  } finally {
    db.close()
  }
}
