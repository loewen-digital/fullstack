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
} from './types.js'
import { paginate as paginateHelper } from './pagination.js'
import { runMigrations, rollbackMigration, getMigrationStatus } from './migrations.js'
import { runSeed } from './seeds.js'
import { createFactory } from './factories.js'

export type { DbInstance, PaginationResult, PaginationOptions, MigrationStatus, FactoryDefinition, Factory }
export { paginate as paginateHelper } from './pagination.js'

/**
 * Create a database instance wrapping Drizzle ORM.
 *
 * Currently supports: `sqlite` (via better-sqlite3)
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

  // Lazy-require so consumers who don't use sqlite don't pay the cost.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof BetterSqlite3Ctor
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3') as typeof DrizzleBetterSqlite3

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
