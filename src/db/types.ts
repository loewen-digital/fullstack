import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export interface PaginationResult<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  lastPage: number
}

export interface PaginationOptions {
  page?: number
  perPage?: number
}

export interface MigrationStatus {
  name: string
  applied: boolean
  appliedAt?: Date
}

export interface FactoryDefinition<T> {
  build(overrides?: Partial<T>): T
  insert?(db: DbInstance, item: T): Promise<T>
}

export interface Factory<T> {
  make(overrides?: Partial<T>): T
  create(overrides?: Partial<T>): Promise<T>
  createMany(count: number, overrides?: Partial<T>): Promise<T[]>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDrizzleDb = BetterSQLite3Database<any>

export interface DbInstance<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /** The underlying Drizzle ORM instance — use this for all queries */
  drizzle: BetterSQLite3Database<TSchema>
  /** Run pending migrations from the given folder (defaults to config.migrations) */
  migrate(folder?: string): Promise<void>
  /** Roll back the last migration (removes last entry from __drizzle_migrations) */
  rollback(): Promise<void>
  /** Get migration status */
  migrationStatus(): Promise<MigrationStatus[]>
  /** Run a seed function against this db instance */
  seed(seedFn: (db: DbInstance<TSchema>) => Promise<void>): Promise<void>
  /** Compute pagination metadata for a data/total pair */
  paginate<T>(data: T[], total: number, options?: PaginationOptions): PaginationResult<T>
  /** Create a test data factory bound to this db instance */
  factory<T>(definition: FactoryDefinition<T>): Factory<T>
  /** Close the underlying database connection */
  close(): void
}
