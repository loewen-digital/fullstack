---
title: Search
description: Full-text search with SQLite FTS, Meilisearch, and Typesense drivers
---

# Search

The `search` module provides full-text search with a consistent API across multiple backends. Start with SQLite FTS for zero-infrastructure search and upgrade to Meilisearch or Typesense when you need more power.

## Import

```ts
import { createSearch } from '@loewen-digital/fullstack/search'
```

## Basic usage

```ts
import { createSearch } from '@loewen-digital/fullstack/search'

const search = createSearch({
  driver: 'sqlite-fts',
  db: dbInstance,
})

// Index a document
await search.index('posts').upsert({
  id: '1',
  title: 'Getting Started with Fullstack',
  body: 'A guide to setting up @loewen-digital/fullstack...',
})

// Search
const results = await search.index('posts').search('fullstack guide')
// results.hits — array of matching documents
// results.total — total number of matches
```

## Bulk indexing

```ts
const posts = await db.query.posts.findMany()

await search.index('posts').upsertMany(
  posts.map((p) => ({ id: String(p.id), title: p.title, body: p.body }))
)
```

## Filtering and sorting

```ts
const results = await search.index('posts').search('typescript', {
  filter: 'status = published',
  sort: ['publishedAt:desc'],
  limit: 20,
  offset: 0,
})
```

## Removing documents

```ts
await search.index('posts').delete('1')
await search.index('posts').deleteAll()
```

## Driver options

| Driver | Description |
|---|---|
| `sqlite-fts` | SQLite FTS5 full-text search. Zero infrastructure required. |
| `meilisearch` | [Meilisearch](https://meilisearch.com). Requires `meilisearch` npm package. |
| `typesense` | [Typesense](https://typesense.org). Requires `typesense` npm package. |

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'sqlite-fts' \| 'meilisearch' \| 'typesense'` | — | Search driver |
| `db` | `DbInstance` | — | Database instance (required for `sqlite-fts`) |
| `meilisearch.host` | `string` | — | Meilisearch server URL |
| `meilisearch.apiKey` | `string` | — | Meilisearch master/search key |
| `typesense.nodes` | `Node[]` | — | Typesense server nodes |
| `typesense.apiKey` | `string` | — | Typesense API key |
