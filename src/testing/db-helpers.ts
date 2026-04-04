/**
 * Database test helpers.
 *
 * Provides transaction-based test isolation for SQLite:
 * each test runs inside a savepoint that is rolled back after the test,
 * leaving the database clean for the next test.
 *
 * Usage:
 *   import { withSavepoint, createDbCleaner } from '@loewen-digital/fullstack/testing'
 *
 *   const db = createDb({ driver: 'sqlite', url: ':memory:' })
 *   await db.migrate()
 *
 *   // In tests:
 *   await withSavepoint(db.drizzle, async () => {
 *     // inserts here are rolled back after
 *     await db.drizzle.insert(users).values({ ... })
 *     const result = await db.drizzle.select().from(users)
 *     expect(result).toHaveLength(1)
 *   })
 *   // DB is clean again
 */

import type { DbInstance } from '../db/index.js'

// We import sql lazily to avoid bundling drizzle when not needed
type DrizzleDb = DbInstance['drizzle']

/**
 * Run a function inside a SQLite savepoint that is always rolled back.
 * Ideal for test isolation — each test gets a clean slate without
 * recreating the database.
 *
 * Only works with better-sqlite3 (SQLite) databases.
 */
export async function withSavepoint<T>(
  drizzle: DrizzleDb,
  fn: (db: DrizzleDb) => Promise<T>,
): Promise<T> {
  const savepointName = `sp_${Math.random().toString(36).slice(2)}`

  // better-sqlite3's run() is synchronous
  const raw = (drizzle as unknown as { run: (sql: string) => void }).run
  if (typeof raw !== 'function') {
    throw new Error('withSavepoint only supports better-sqlite3 (synchronous SQLite)')
  }

  const runRaw = (sql: string) => {
    ;(drizzle as unknown as { run: (sql: string) => void }).run(sql)
  }

  runRaw(`SAVEPOINT "${savepointName}"`)

  try {
    const result = await fn(drizzle)
    runRaw(`ROLLBACK TO SAVEPOINT "${savepointName}"`)
    runRaw(`RELEASE SAVEPOINT "${savepointName}"`)
    return result
  } catch (err) {
    runRaw(`ROLLBACK TO SAVEPOINT "${savepointName}"`)
    runRaw(`RELEASE SAVEPOINT "${savepointName}"`)
    throw err
  }
}

/**
 * Create a cleaner that truncates specific tables between tests.
 * Simpler than savepoints when you just want to DELETE all rows.
 *
 * Usage:
 *   const cleaner = createDbCleaner(db.drizzle)
 *   afterEach(() => cleaner.truncate('users', 'sessions'))
 */
export function createDbCleaner(drizzle: DrizzleDb) {
  const runRaw = (sql: string) => {
    ;(drizzle as unknown as { run: (sql: string) => void }).run(sql)
  }

  return {
    /**
     * Delete all rows from the given tables.
     * Disables foreign key checks during truncation.
     */
    truncate(...tables: string[]): void {
      runRaw('PRAGMA foreign_keys = OFF')
      for (const table of tables) {
        // Use parameterized approach — table names can't be parameterized in SQL
        // so we sanitize by allowing only safe identifier characters
        const safe = table.replace(/[^a-zA-Z0-9_]/g, '')
        if (safe !== table) {
          throw new Error(`Unsafe table name: "${table}"`)
        }
        runRaw(`DELETE FROM "${safe}"`)
      }
      runRaw('PRAGMA foreign_keys = ON')
    },

    /**
     * Reset auto-increment sequences for the given tables.
     * Useful when tests depend on predictable IDs.
     */
    resetSequences(...tables: string[]): void {
      for (const table of tables) {
        const safe = table.replace(/[^a-zA-Z0-9_]/g, '')
        if (safe !== table) {
          throw new Error(`Unsafe table name: "${table}"`)
        }
        try {
          runRaw(`DELETE FROM "sqlite_sequence" WHERE name = '${safe}'`)
        } catch {
          // sqlite_sequence doesn't exist until AUTOINCREMENT is used — ignore
        }
      }
    },
  }
}

/**
 * Seed helper: run a seed function once and return the result.
 * Useful in beforeAll() to set up shared fixture data.
 *
 * Usage:
 *   const { users } = await seedOnce(db, async (db) => {
 *     const users = await db.drizzle.insert(usersTable).values([...]).returning()
 *     return { users }
 *   })
 */
export async function seedOnce<T>(db: DbInstance, fn: (db: DbInstance) => Promise<T>): Promise<T> {
  return fn(db)
}
