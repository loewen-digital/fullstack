/**
 * The R2 binding driver against an in-memory bucket that pages `list` two keys at a time, and
 * the binding slice it declares against Cloudflare's own `R2Bucket` (`@cloudflare/workers-types`
 * is a devDependency only): `npm run typecheck` fails when the slice drifts from the binding.
 */
import { describe, it, expect } from 'vitest'
import type { R2Bucket } from '@cloudflare/workers-types'
import { createR2BindingDriver, createStorageInstance, type R2BindingBucket } from '../index.js'

interface Stored {
  bytes: Uint8Array
  contentType?: string
}

function fakeBucket(pageSize = 2): R2BindingBucket & { store: Map<string, Stored> } {
  const store = new Map<string, Stored>()
  return {
    store,
    async head(key) {
      return store.has(key) ? { key } : null
    },
    async get(key) {
      const entry = store.get(key)
      return entry ? { arrayBuffer: async () => entry.bytes.slice().buffer } : null
    },
    async put(key, value, options) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
      store.set(key, { bytes, contentType: options?.httpMetadata?.contentType })
    },
    async delete(key) {
      store.delete(key)
    },
    async list(options) {
      const keys = [...store.keys()].filter((key) => !options?.prefix || key.startsWith(options.prefix)).sort()
      const start = options?.cursor ? Number(options.cursor) : 0
      const page = keys.slice(start, start + pageSize)
      const truncated = start + pageSize < keys.length
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + pageSize) : undefined }
    },
  }
}

describe('R2 binding driver', () => {
  it('puts bytes, a string or a stream and gets them back on a plain ArrayBuffer', async () => {
    const bucket = fakeBucket()
    const storage = createStorageInstance(createR2BindingDriver({ bucket }))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('str'))
        controller.enqueue(new TextEncoder().encode('eam'))
        controller.close()
      },
    })

    await storage.put('a.bin', new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' })
    await storage.put('b.txt', 'text')
    await storage.put('c.txt', stream)

    const bytes = await storage.get('a.bin')
    expect(Array.from(bytes!)).toEqual([1, 2, 3])
    expect(bytes!.buffer).toBeInstanceOf(ArrayBuffer)
    expect(await storage.getText('b.txt')).toBe('text')
    expect(await storage.getText('c.txt')).toBe('stream')
    expect(bucket.store.get('a.bin')!.contentType).toBe('application/octet-stream')
    expect(bucket.store.get('b.txt')!.contentType).toBeUndefined()
  })

  it('get is null when missing, exists follows head, delete removes', async () => {
    const storage = createStorageInstance(createR2BindingDriver({ bucket: fakeBucket() }))
    expect(await storage.get('nope')).toBeNull()
    expect(await storage.exists('nope')).toBe(false)
    await storage.put('yes', 'y')
    expect(await storage.exists('yes')).toBe(true)
    await storage.delete('yes')
    expect(await storage.exists('yes')).toBe(false)
    await expect(storage.delete('nope')).resolves.toBeUndefined()
  })

  it('list walks every page and honours the prefix', async () => {
    const storage = createStorageInstance(createR2BindingDriver({ bucket: fakeBucket(2) }))
    for (const key of ['img/1', 'img/2', 'img/3', 'img/4', 'img/5', 'doc/1']) await storage.put(key, key)
    expect(await storage.list('img/')).toEqual(['img/1', 'img/2', 'img/3', 'img/4', 'img/5'])
    expect(await storage.list()).toHaveLength(6)
    expect(await storage.list('none/')).toEqual([])
  })

  it('getUrl is publicUrl/key, and an error without publicUrl', async () => {
    const withUrl = createStorageInstance(createR2BindingDriver({ bucket: fakeBucket(), publicUrl: 'https://files.example.com/' }))
    expect(await withUrl.getUrl('img/a b.png')).toBe('https://files.example.com/img/a%20b.png')

    const without = createStorageInstance(createR2BindingDriver({ bucket: fakeBucket() }))
    await expect(without.getUrl('img/a.png')).rejects.toThrow('R2 binding has no URL for "img/a.png"')
  })

  it("the binding slice is satisfied by Cloudflare's R2Bucket (type-checked here)", () => {
    const takes = (bucket: R2BindingBucket): R2BindingBucket => bucket
    const real = {} as R2Bucket
    expect(takes(real)).toBe(real)
  })
})
