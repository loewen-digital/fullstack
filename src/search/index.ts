import type { SearchConfig, SearchDriver, SearchInstance } from './types.js'
import { createSqliteFtsDriver } from './drivers/sqlite-fts.js'

export type {
  SearchConfig,
  SearchDocument,
  SearchDriver,
  SearchInstance,
  SearchOptions,
  SearchResult,
} from './types.js'
export { createSqliteFtsDriver } from './drivers/sqlite-fts.js'
export { createMeilisearchDriver } from './drivers/meilisearch.js'
export { createTypesenseDriver } from './drivers/typesense.js'

/**
 * Create a search instance.
 *
 * Usage:
 *   const search = createSearch({ driver: 'sqlite-fts' })
 *   await search.index('posts', [{ id: '1', title: 'Hello world' }])
 *   const results = await search.search('posts', 'hello')
 */
export function createSearch(config: SearchConfig): SearchInstance {
  let driver: SearchDriver

  if (config.driver === 'sqlite-fts') {
    driver = createSqliteFtsDriver(config.url)
  } else if (config.driver === 'meilisearch') {
    throw new Error(
      'Meilisearch driver requires a running Meilisearch instance. ' +
        'Import createMeilisearchDriver from @loewen-digital/fullstack/search and configure it.',
    )
  } else if (config.driver === 'typesense') {
    throw new Error(
      'Typesense driver requires a running Typesense instance. ' +
        'Import createTypesenseDriver from @loewen-digital/fullstack/search and configure it.',
    )
  } else if (typeof config.driver === 'object') {
    driver = config.driver as SearchDriver
  } else {
    throw new Error(`Unknown search driver: "${config.driver}"`)
  }

  return {
    index: (collection, documents) => driver.index(collection, documents),
    search: (collection, query, options) => driver.search(collection, query, options),
    delete: (collection, id) => driver.delete(collection, id),
    flush: (collection) => driver.flush(collection),
  }
}
