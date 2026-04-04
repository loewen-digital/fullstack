import type { SearchDocument, SearchDriver, SearchOptions, SearchResult } from '../types.js'

/**
 * Meilisearch driver.
 * Requires Meilisearch to be running and accessible at `host`.
 * Uses the fetch-based REST API so no extra npm package is required.
 */
export function createMeilisearchDriver(config: {
  host: string
  apiKey?: string
}): SearchDriver {
  const { host, apiKey } = config

  function headers(): HeadersInit {
    const h: HeadersInit = { 'Content-Type': 'application/json' }
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`
    return h
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${host}${path}`, {
      method,
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meilisearch ${method} ${path} failed (${res.status}): ${text}`)
    }
    return res.json() as Promise<T>
  }

  return {
    async index(collection: string, documents: SearchDocument[]): Promise<void> {
      await request('POST', `/indexes/${collection}/documents`, documents)
    },

    async search(
      collection: string,
      query: string,
      options?: SearchOptions,
    ): Promise<SearchResult> {
      const body: Record<string, unknown> = {
        q: query,
        limit: options?.limit ?? 20,
        offset: options?.offset ?? 0,
      }
      if (options?.filters) {
        body['filter'] = Object.entries(options.filters)
          .map(([k, v]) => `${k} = "${String(v)}"`)
          .join(' AND ')
      }

      const result = await request<{ hits: SearchDocument[]; estimatedTotalHits: number }>(
        'POST',
        `/indexes/${collection}/search`,
        body,
      )
      return { hits: result.hits, total: result.estimatedTotalHits, query }
    },

    async delete(collection: string, id: string): Promise<void> {
      await request('DELETE', `/indexes/${collection}/documents/${id}`)
    },

    async flush(collection: string): Promise<void> {
      await request('DELETE', `/indexes/${collection}/documents`)
    },
  }
}
