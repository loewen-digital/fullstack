import type { DbInstance } from './types.js'

export type SeedFn<TSchema extends Record<string, unknown>> = (
  db: DbInstance<TSchema>,
) => Promise<void>

/**
 * Run a seed function against the given db instance.
 * Wraps execution in a try/catch so seed errors surface clearly.
 */
export async function runSeed<TSchema extends Record<string, unknown>>(
  db: DbInstance<TSchema>,
  seedFn: SeedFn<TSchema>,
): Promise<void> {
  try {
    await seedFn(db)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Seed failed: ${message}`, { cause: err })
  }
}
