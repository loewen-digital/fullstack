import type { Factory, FactoryDefinition, DbInstance } from './types.js'

/**
 * Create a test-data factory bound to a db instance.
 *
 * Usage:
 *   const userFactory = db.factory({
 *     build: (overrides) => ({
 *       id: crypto.randomUUID(),
 *       name: 'Alice',
 *       email: 'alice@example.com',
 *       ...overrides,
 *     }),
 *     insert: async (db, user) => {
 *       await db.drizzle.insert(users).values(user)
 *       return user
 *     },
 *   })
 *
 *   const user = await userFactory.create({ name: 'Bob' })
 */
export function createFactory<T>(
  definition: FactoryDefinition<T>,
  db: DbInstance,
): Factory<T> {
  return {
    make(overrides?: Partial<T>): T {
      return definition.build(overrides)
    },

    async create(overrides?: Partial<T>): Promise<T> {
      const item = definition.build(overrides)
      if (definition.insert) {
        return definition.insert(db, item)
      }
      return item
    },

    async createMany(count: number, overrides?: Partial<T>): Promise<T[]> {
      const results: T[] = []
      for (let i = 0; i < count; i++) {
        const item = definition.build(overrides)
        if (definition.insert) {
          results.push(await definition.insert(db, item))
        } else {
          results.push(item)
        }
      }
      return results
    },
  }
}
