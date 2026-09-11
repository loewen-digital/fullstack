---
title: Search
description: Full-text search over JSON documents on SQLite FTS5, Meilisearch or Typesense
---

# Search

`createSearch` indexes documents (`{ id, ...fields }`) into named collections and searches them. SQLite FTS5 is built in and needs no service; Meilisearch and Typesense are reached through `fetch` with a driver factory each.

## Import

```ts
import { createSearch } from '@loewen-digital/fullstack/search'
```

## Basic usage

```ts
import { createSearch } from '@loewen-digital/fullstack/search'

export const search = createSearch({ driver: 'sqlite-fts', url: './search.db' }) // ':memory:' by default

async function indexPosts() {
  await search.index('posts', [
    { id: '1', title: 'Getting started with fullstack', body: 'A guide to the first login', status: 'published' },
    { id: '2', title: 'Search on SQLite', body: 'FTS5 without a service', status: 'draft' },
  ])
}

async function find(query: string) {
  const result = await search.search('posts', query, { filters: { status: 'published' }, limit: 20, offset: 0 })
  return result // { hits: SearchDocument[], total, query }
}
```

`index` upserts by `id`; a document with a known id replaces the old one. `delete(collection, id)` removes one, `flush(collection)` all.

```ts
async function unpublish(id: string) {
  await search.delete('posts', id)
}

async function reindex(all: Array<{ id: string; title: string }>) {
  await search.flush('posts')
  await search.index('posts', all)
}
```

## What is searched

The SQLite driver concatenates every string and number field of a document into one FTS5 column (`porter ascii` tokenizer) and matches the query as a phrase: `'first login'` finds documents that contain those two words in that order. An empty query lists the collection. `filters` are equality checks applied to the hits after the query, and `total` counts the hits of that page. Meilisearch and Typesense search all fields on their side, turn `filters` into their filter expression and report their own totals.

## Drivers

```ts
import { createSearch, createMeilisearchDriver, createTypesenseDriver } from '@loewen-digital/fullstack/search'

const onMeilisearch = createSearch({
  driver: createMeilisearchDriver({ host: 'http://127.0.0.1:7700', apiKey: process.env.MEILI_KEY }),
})

const onTypesense = createSearch({
  driver: createTypesenseDriver({ host: 'http://127.0.0.1:8108', apiKey: process.env.TYPESENSE_KEY! }),
})
```

| Driver | Options | Notes |
|---|---|---|
| `sqlite-fts` (`createSearch({ driver: 'sqlite-fts', url? })`) | `url`: database file, default `:memory:` | two tables per collection (`<name>_docs`, `<name>_fts`), created on first use |
| `createMeilisearchDriver({ host, apiKey? })` | Meilisearch's REST API | one index per collection |
| `createTypesenseDriver({ host, apiKey })` | Typesense's REST API | one collection per collection |

A custom driver implements `SearchDriver` (`index`, `search`, `delete`, `flush`) and goes into `createSearch({ driver })` like the factories above.

## Config options

`createSearch(config)` reads these.

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'sqlite-fts' \| SearchDriver` | — | Naming `meilisearch` or `typesense` as a string throws; pass the driver object |
| `url` | `string` | `':memory:'` | SQLite database path for `sqlite-fts` |

`host` and `apiKey` are declared on the config type but read by the driver factories, not by `createSearch`.
