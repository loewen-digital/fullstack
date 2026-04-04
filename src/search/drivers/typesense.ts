import type { SearchDocument, SearchDriver, SearchOptions, SearchResult } from '../types.js'

/**
 * Typesense driver.
 * Uses Typesense's REST API via fetch.
 */
export function createTypesenseDriver(config: {
  host: string
  apiKey: string
}): SearchDriver {
  const { host, apiKey } = config

  function headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-TYPESENSE-API-KEY': apiKey,
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${host}${path}`, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Typesense ${method} ${path} failed (${res.status}): ${text}`)
    }
    return res.json() as Promise<T>
  }

  /** Ensure the collection (schema) exists, creating it if not. */
  async function ensureCollection(collection: string): Promise<void> {
    try {
      await request('GET', `/collections/${collection}`)
    } catch {
      // Create with a catch-all auto-schema
      await request('POST', '/collections', {
        name: collection,
        fields: [{ name: '.*', type: 'auto' }],
      })
    }
  }

  return {
    async index(collection: string, documents: SearchDocument[]): Promise<void> {
      await ensureCollection(collection)
      // Typesense bulk import via JSONL
      const ndjson = documents.map((d) => JSON.stringify(d)).join('\n')
      const res = await fetch(`${host}/collections/${collection}/documents/import?action=upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-TYPESENSE-API-KEY': apiKey,
        },
        body: ndjson,
      })
      if (!res.ok) {
        throw new Error(`Typesense import failed (${res.status})`)
      }
    },

    async search(
      collection: string,
      query: string,
      options?: SearchOptions,
    ): Promise<SearchResult> {
      const params = new URLSearchParams({
        q: query || '*',
        query_by: '*',
        per_page: String(options?.limit ?? 20),
        page: String(Math.floor((options?.offset ?? 0) / (options?.limit ?? 20)) + 1),
      })
      if (options?.filters) {
        params.set(
          'filter_by',
          Object.entries(options.filters)
            .map(([k, v]) => `${k}:=${String(v)}`)
            .join(' && '),
        )
      }

      const result = await request<{
        hits: Array<{ document: SearchDocument }>
        found: number
      }>('GET', `/collections/${collection}/documents/search?${params.toString()}`)

      return {
        hits: result.hits.map((h) => h.document),
        total: result.found,
        query,
      }
    },

    async delete(collection: string, id: string): Promise<void> {
      await request('DELETE', `/collections/${collection}/documents/${id}`)
    },

    async flush(collection: string): Promise<void> {
      await request('DELETE', `/collections/${collection}/documents`, { filter_by: 'id:>0' })
    },
  }
}
