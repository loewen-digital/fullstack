import { createRequire } from 'node:module'
import type { DbConfig } from '../config/types.js'
import type { default as BetterSqlite3Ctor } from 'better-sqlite3'
import type * as DrizzleBetterSqlite3 from 'drizzle-orm/better-sqlite3'
import type {
  DbInstance,
  PaginationOptions,
  PaginationResult,
  FactoryDefinition,
  Factory,
  MigrationStatus,
  AnyDrizzleDb,
} from './types.js'
import { paginate as paginateHelper } from './pagination.js'
import { runMigrations, rollbackMigration, getMigrationStatus } from './migrations.js'
import { runSeed } from './seeds.js'
import { createFactory } from './factories.js'

export type { DbConfig }
export type { DbInstance, PaginationResult, PaginationOptions, MigrationStatus, FactoryDefinition, Factory, AnyDrizzleDb }
export { paginate as paginateHelper } from './pagination.js'

// better-sqlite3 is a native binding and an optional peer dependency: it is loaded when the
// factory runs, not when this module is imported. The package ships ESM, hence createRequire.
const load = createRequire(import.meta.url)

function loadBetterSqlite3(): typeof BetterSqlite3Ctor {
  try {
    return load('better-sqlite3') as typeof BetterSqlite3Ctor
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error('The sqlite driver needs better-sqlite3, an optional peer dependency: npm install better-sqlite3', {
        cause: error,
      })
    }
    throw error
  }
}

/**
 * Create a database instance wrapping Drizzle ORM.
 *
 * Currently supports: `sqlite` (via better-sqlite3, an optional peer: `npm install better-sqlite3`)
 * Postgres, MySQL, and D1 support requires the corresponding peer dependencies.
 *
 * Usage:
 *   const db = createDb({ driver: 'sqlite', url: ':memory:' })
 *   await db.migrate('./drizzle')
 *   const result = await db.drizzle.select().from(users)
 */
export function createDb<TSchema extends Record<string, unknown> = Record<string, unknown>>(
  config: DbConfig,
  schema?: TSchema,
): DbInstance<TSchema> {
  if (config.driver !== 'sqlite') {
    throw new Error(
      `Driver "${config.driver}" requires additional peer dependencies. ` +
        `Install the corresponding package and use its Drizzle adapter directly. ` +
        `Currently bundled: sqlite (better-sqlite3).`,
    )
  }

  const Database = loadBetterSqlite3()
  const { drizzle } = load('drizzle-orm/better-sqlite3') as typeof DrizzleBetterSqlite3

  const sqlite = new Database(config.url)
  // Enable WAL mode for better concurrent read performance
  if (config.url !== ':memory:') {
    sqlite.pragma('journal_mode = WAL')
  }

  const drizzleDb = drizzle(sqlite, schema ? { schema } : {}) as DrizzleBetterSqlite3.BetterSQLite3Database<TSchema>

  const migrationsFolder = config.migrations ?? './drizzle'

  // Self-reference needed for factory/seed bindings
  const instance: DbInstance<TSchema> = {
    drizzle: drizzleDb,

    async migrate(folder?: string): Promise<void> {
      await runMigrations(drizzleDb, folder ?? migrationsFolder)
    },

    async rollback(): Promise<void> {
      await rollbackMigration(drizzleDb)
    },

    async migrationStatus(): Promise<MigrationStatus[]> {
      return getMigrationStatus(drizzleDb)
    },

    async seed(seedFn): Promise<void> {
      await runSeed(instance, seedFn)
    },

    paginate<T>(data: T[], total: number, options?: PaginationOptions): PaginationResult<T> {
      return paginateHelper(data, total, options)
    },

    factory<T>(definition: FactoryDefinition<T>): Factory<T> {
      return createFactory(definition, instance as unknown as DbInstance)
    },

    close(): void {
      sqlite.close()
    },
  }

  return instance
}
