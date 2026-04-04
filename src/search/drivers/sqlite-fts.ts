import type { SearchDocument, SearchDriver, SearchOptions, SearchResult } from '../types.js'

/**
 * SQLite FTS5 search driver using better-sqlite3.
 *
 * Each collection becomes a pair of tables:
 *   - `{collection}_docs`  — stores the original JSON document (keyed by id)
 *   - `{collection}_fts`   — virtual FTS5 table indexing all text fields
 */
export function createSqliteFtsDriver(urlOrDb?: string): SearchDriver {
  // Lazy-load better-sqlite3 so that it remains an optional peer dependency
  // during tests that don't use this driver.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const db = new Database(urlOrDb ?? ':memory:')
  db.pragma('journal_mode = WAL')

  const initializedCollections = new Set<string>()

  function initCollection(collection: string): void {
    if (initializedCollections.has(collection)) return
    initializedCollections.add(collection)

    db.exec(`
      CREATE TABLE IF NOT EXISTS "${collection}_docs" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS "${collection}_fts"
        USING fts5(
          id UNINDEXED,
          content,
          tokenize = 'porter ascii'
        );
    `)
  }

  /** Concatenate all string/number values from a document for full-text indexing */
  function toFtsContent(doc: SearchDocument): string {
    return Object.values(doc)
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join(' ')
  }

  return {
    async index(collection: string, documents: SearchDocument[]): Promise<void> {
      initCollection(collection)

      const upsertDoc = db.prepare(
        `INSERT INTO "${collection}_docs" (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      const deleteFts = db.prepare(`DELETE FROM "${collection}_fts" WHERE id = ?`)
      const insertFts = db.prepare(
        `INSERT INTO "${collection}_fts" (id, content) VALUES (?, ?)`,
      )

      const upsertAll = db.transaction((docs: SearchDocument[]) => {
        for (const doc of docs) {
          upsertDoc.run(doc.id, JSON.stringify(doc))
          deleteFts.run(doc.id)
          insertFts.run(doc.id, toFtsContent(doc))
        }
      })

      upsertAll(documents)
    },

    async search(
      collection: string,
      query: string,
      options?: SearchOptions,
    ): Promise<SearchResult> {
      initCollection(collection)

      const limit = options?.limit ?? 20
      const offset = options?.offset ?? 0

      let rows: Array<{ id: string; data: string }>

      if (query.trim() === '') {
        // Empty query — return all docs
        rows = db
          .prepare(`SELECT id, data FROM "${collection}_docs" LIMIT ? OFFSET ?`)
          .all(limit, offset) as Array<{ id: string; data: string }>
      } else {
        const escaped = query.replace(/"/g, '""')
        rows = db
          .prepare(
            `SELECT d.id, d.data
             FROM "${collection}_docs" d
             INNER JOIN "${collection}_fts" f ON f.id = d.id
             WHERE "${collection}_fts" MATCH ?
             LIMIT ? OFFSET ?`,
          )
          .all(`"${escaped}"`, limit, offset) as Array<{ id: string; data: string }>
      }

      let hits = rows.map((r) => JSON.parse(r.data) as SearchDocument)

      // Apply in-memory filters (simple equality)
      if (options?.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          hits = hits.filter((h) => h[key] === value)
        }
      }

      return { hits, total: hits.length, query }
    },

    async delete(collection: string, id: string): Promise<void> {
      initCollection(collection)
      db.prepare(`DELETE FROM "${collection}_docs" WHERE id = ?`).run(id)
      db.prepare(`DELETE FROM "${collection}_fts" WHERE id = ?`).run(id)
    },

    async flush(collection: string): Promise<void> {
      initCollection(collection)
      db.prepare(`DELETE FROM "${collection}_docs"`).run()
      db.prepare(`DELETE FROM "${collection}_fts"`).run()
    },
  }
}
