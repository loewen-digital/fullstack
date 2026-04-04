export interface SearchConfig {
  driver: 'sqlite-fts' | 'meilisearch' | 'typesense' | SearchDriver
  /** For sqlite-fts: path to the SQLite database (default: ':memory:') */
  url?: string
  /** For meilisearch/typesense: base URL of the service */
  host?: string
  /** API key for Meilisearch or Typesense */
  apiKey?: string
  [key: string]: unknown
}

export interface SearchDocument {
  id: string
  [key: string]: unknown
}

export interface SearchOptions {
  /** Simple key/value filters applied after search */
  filters?: Record<string, unknown>
  limit?: number
  offset?: number
}

export interface SearchResult {
  hits: SearchDocument[]
  total: number
  query: string
}

export interface SearchDriver {
  /** Index (upsert) documents into a collection */
  index(collection: string, documents: SearchDocument[]): Promise<void>
  /** Full-text search within a collection */
  search(collection: string, query: string, options?: SearchOptions): Promise<SearchResult>
  /** Remove a document by id */
  delete(collection: string, id: string): Promise<void>
  /** Remove all documents from a collection */
  flush(collection: string): Promise<void>
}

export interface SearchInstance {
  index(collection: string, documents: SearchDocument[]): Promise<void>
  search(collection: string, query: string, options?: SearchOptions): Promise<SearchResult>
  delete(collection: string, id: string): Promise<void>
  flush(collection: string): Promise<void>
}
