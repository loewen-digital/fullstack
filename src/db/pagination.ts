import type { PaginationResult, PaginationOptions } from './types.js'

/**
 * Compute pagination metadata for a pre-fetched result set.
 *
 * Usage:
 *   const data = await db.select().from(users).limit(perPage).offset((page - 1) * perPage)
 *   const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users)
 *   return paginate(data, count, { page, perPage })
 */
export function paginate<T>(
  data: T[],
  total: number,
  options: PaginationOptions = {},
): PaginationResult<T> {
  const page = Math.max(1, options.page ?? 1)
  const perPage = Math.max(1, options.perPage ?? 15)
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  return { data, total, page, perPage, lastPage }
}
