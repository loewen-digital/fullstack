/**
 * Test factory builder — create typed test data with sensible defaults.
 *
 * The DB module already includes createFactory() tied to a DbInstance.
 * This standalone version creates factories that work without a DB,
 * useful for unit tests and non-DB scenarios.
 *
 * Usage:
 *   const userFactory = defineFactory({
 *     name: () => 'Alice',
 *     email: () => `alice+${Date.now()}@example.com`,
 *     role: () => 'user' as const,
 *   })
 *
 *   const user = userFactory.make()
 *   const admin = userFactory.make({ role: 'admin' })
 *   const users = userFactory.makeMany(5)
 */

export type FactoryFn<T> = {
  [K in keyof T]: () => T[K]
}

export interface StandaloneFactory<T> {
  /** Build one record without persisting */
  make(overrides?: Partial<T>): T
  /** Build N records without persisting */
  makeMany(count: number, overrides?: Partial<T>): T[]
  /** Create a variant factory with different defaults */
  state(overrides: Partial<{ [K in keyof T]: () => T[K] }>): StandaloneFactory<T>
}

/**
 * Define a standalone factory for creating test data.
 *
 * Each field is a function that returns a default value.
 * This ensures each call gets fresh values (avoiding shared references).
 */
export function defineFactory<T>(definition: FactoryFn<T>): StandaloneFactory<T> {
  function make(overrides?: Partial<T>): T {
    const data: Record<string, unknown> = {}
    for (const key of Object.keys(definition) as Array<keyof T & string>) {
      data[key] = definition[key]()
    }
    return Object.assign(data, overrides) as T
  }

  return {
    make,

    makeMany(count: number, overrides?: Partial<T>): T[] {
      return Array.from({ length: count }, () => make(overrides))
    },

    state(stateOverrides: Partial<FactoryFn<T>>): StandaloneFactory<T> {
      return defineFactory<T>({
        ...definition,
        ...stateOverrides,
      } as FactoryFn<T>)
    },
  }
}

/**
 * Counter-based sequence helper for unique values in tests.
 *
 * Usage:
 *   const seq = sequence()
 *   const emailFactory = defineFactory({
 *     email: () => `user${seq()}@example.com`,
 *   })
 */
export function sequence(start = 1): () => number {
  let count = start
  return () => count++
}

/**
 * Pick a random element from an array.
 * Useful in factory definitions for varied test data.
 */
export function pick<T>(values: [T, ...T[]]): () => T {
  return () => values[Math.floor(Math.random() * values.length)]!
}
