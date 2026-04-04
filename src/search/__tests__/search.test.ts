import { describe, it, expect, beforeEach } from 'vitest'
import { createSearch, createSqliteFtsDriver } from '../index.js'

describe('createSearch', () => {
  it('creates an instance with sqlite-fts driver', () => {
    const search = createSearch({ driver: 'sqlite-fts' })
    expect(search.index).toBeInstanceOf(Function)
    expect(search.search).toBeInstanceOf(Function)
    expect(search.delete).toBeInstanceOf(Function)
    expect(search.flush).toBeInstanceOf(Function)
  })

  it('throws on meilisearch driver without config', () => {
    expect(() => createSearch({ driver: 'meilisearch' })).toThrow('Meilisearch driver requires')
  })

  it('throws on typesense driver without config', () => {
    expect(() => createSearch({ driver: 'typesense' })).toThrow('Typesense driver requires')
  })

  it('throws on unknown driver', () => {
    expect(() => createSearch({ driver: 'unknown' as never })).toThrow('Unknown search driver')
  })

  it('accepts a custom driver object', async () => {
    const indexed: unknown[] = []
    const customDriver = {
      async index(_c: string, docs: unknown[]) { indexed.push(...docs) },
      async search() { return { hits: [], total: 0, query: '' } },
      async delete() {},
      async flush() {},
    }
    const search = createSearch({ driver: customDriver })
    await search.index('posts', [{ id: '1', title: 'Hello' }])
    expect(indexed).toHaveLength(1)
  })
})

describe('SQLite FTS driver', () => {
  // Use a fresh in-memory DB per test group
  function makeSearch() {
    return createSearch({ driver: 'sqlite-fts', url: ':memory:' })
  }

  it('indexes and retrieves documents', async () => {
    const search = makeSearch()
    await search.index('posts', [
      { id: '1', title: 'Hello World', body: 'First post content' },
      { id: '2', title: 'Another Post', body: 'Second post content' },
    ])
    const result = await search.search('posts', 'Hello')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.id).toBe('1')
    expect(result.query).toBe('Hello')
  })

  it('returns all documents for empty query', async () => {
    const search = makeSearch()
    await search.index('posts', [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ])
    const result = await search.search('posts', '')
    expect(result.hits).toHaveLength(2)
  })

  it('search is case-insensitive', async () => {
    const search = makeSearch()
    await search.index('posts', [{ id: '1', title: 'TypeScript is great' }])
    const result = await search.search('posts', 'typescript')
    expect(result.hits).toHaveLength(1)
  })

  it('returns empty hits when no match', async () => {
    const search = makeSearch()
    await search.index('posts', [{ id: '1', title: 'Hello' }])
    const result = await search.search('posts', 'nonexistent')
    expect(result.hits).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('upserts documents on re-index', async () => {
    const search = makeSearch()
    await search.index('posts', [{ id: '1', title: 'Original' }])
    await search.index('posts', [{ id: '1', title: 'Updated' }])
    const result = await search.search('posts', 'Updated')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.title).toBe('Updated')
  })

  it('deletes a document', async () => {
    const search = makeSearch()
    await search.index('posts', [
      { id: '1', title: 'Keep' },
      { id: '2', title: 'Remove' },
    ])
    await search.delete('posts', '2')
    const result = await search.search('posts', 'Remove')
    expect(result.hits).toHaveLength(0)
  })

  it('flushes all documents', async () => {
    const search = makeSearch()
    await search.index('posts', [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
    ])
    await search.flush('posts')
    const result = await search.search('posts', '')
    expect(result.hits).toHaveLength(0)
  })

  it('respects limit and offset', async () => {
    const search = makeSearch()
    await search.index('items', [
      { id: '1', title: 'item one' },
      { id: '2', title: 'item two' },
      { id: '3', title: 'item three' },
    ])
    const page1 = await search.search('items', 'item', { limit: 2, offset: 0 })
    const page2 = await search.search('items', 'item', { limit: 2, offset: 2 })
    expect(page1.hits).toHaveLength(2)
    expect(page2.hits).toHaveLength(1)
  })

  it('applies in-memory filters', async () => {
    const search = makeSearch()
    await search.index('posts', [
      { id: '1', title: 'post', status: 'published' },
      { id: '2', title: 'post', status: 'draft' },
    ])
    const result = await search.search('posts', 'post', { filters: { status: 'published' } })
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.status).toBe('published')
  })

  it('searches across multiple collections independently', async () => {
    const search = makeSearch()
    await search.index('posts', [{ id: '1', title: 'Hello from posts' }])
    await search.index('comments', [{ id: '1', title: 'Hello from comments' }])
    const posts = await search.search('posts', 'posts')
    const comments = await search.search('comments', 'comments')
    expect(posts.hits[0]!.title).toContain('posts')
    expect(comments.hits[0]!.title).toContain('comments')
  })

  it('createSqliteFtsDriver can be used directly', async () => {
    const driver = createSqliteFtsDriver(':memory:')
    await driver.index('test', [{ id: '1', content: 'hello' }])
    const result = await driver.search('test', 'hello')
    expect(result.hits).toHaveLength(1)
  })
})
