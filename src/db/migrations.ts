import type { AnyDrizzleDb, MigrationStatus } from './types.js'

/**
 * Run all pending migrations from the given folder.
 * Delegates to Drizzle's built-in migrator for better-sqlite3.
 */
export async function runMigrations(drizzle: AnyDrizzleDb, folder: string): Promise<void> {
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  migrate(drizzle, { migrationsFolder: folder })
}

/**
 * Roll back the most recent migration batch by removing the last entry
 * from Drizzle's internal migrations journal.
 */
export async function rollbackMigration(drizzle: AnyDrizzleDb): Promise<void> {
  const { sql } = await import('drizzle-orm')
  // Drizzle tracks applied migrations in __drizzle_migrations
  const rows = drizzle.all<{ id: number; hash: string; created_at: number }>(
    sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  )
  if (rows.length === 0) return
  const last = rows[0]
  drizzle.run(sql`DELETE FROM __drizzle_migrations WHERE id = ${last.id}`)
}

/**
 * Return the list of applied migrations from Drizzle's journal table.
 * Returns an empty array if the table does not exist yet.
 */
export async function getMigrationStatus(drizzle: AnyDrizzleDb): Promise<MigrationStatus[]> {
  const { sql } = await import('drizzle-orm')
  try {
    const rows = drizzle.all<{ hash: string; created_at: number }>(
      sql`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC`,
    )
    return rows.map((r) => ({
      name: r.hash,
      applied: true,
      appliedAt: new Date(r.created_at),
    }))
  } catch {
    return []
  }
}
