import { describe, it, expect } from 'vitest'
import { createStorage, createStorageInstance, createMemoryDriver } from '../index.js'

describe('createStorage', () => {
  it('creates instance with memory driver', () => {
    const storage = createStorage({ driver: 'memory' })
    expect(storage).toBeDefined()
    expect(storage.get).toBeInstanceOf(Function)
    expect(storage.put).toBeInstanceOf(Function)
  })

  it('throws on unknown driver', () => {
    expect(() => createStorage({ driver: 'unknown' })).toThrow('Unknown storage driver')
  })

  it('throws on local driver without config', () => {
    expect(() => createStorage({ driver: 'local' })).toThrow('Local storage driver requires')
  })

  it('throws on s3 driver without config', () => {
    expect(() => createStorage({ driver: 's3' })).toThrow('S3 storage driver requires')
  })

  it('throws on r2 driver without config', () => {
    expect(() => createStorage({ driver: 'r2' })).toThrow('R2 storage driver requires')
  })
})

describe('memory driver', () => {
  it('puts and gets a string', async () => {
    const storage = createStorage({ driver: 'memory' })
    await storage.put('hello.txt', 'Hello, World!')
    const data = await storage.get('hello.txt')
    expect(data).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(data!)).toBe('Hello, World!')
  })

  it('puts and gets Uint8Array', async () => {
    const storage = createStorage({ driver: 'memory' })
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await storage.put('binary.bin', bytes)
    const data = await storage.get('binary.bin')
    expect(data).toEqual(bytes)
  })

  it('returns null for missing file', async () => {
    const storage = createStorage({ driver: 'memory' })
    const data = await storage.get('missing.txt')
    expect(data).toBeNull()
  })

  it('getText returns string', async () => {
    const storage = createStorage({ driver: 'memory' })
    await storage.put('text.txt', 'Some text')
    const text = await storage.getText('text.txt')
    expect(text).toBe('Some text')
  })

  it('getText returns null for missing file', async () => {
    const storage = createStorage({ driver: 'memory' })
    const text = await storage.getText('missing.txt')
    expect(text).toBeNull()
  })

  it('checks file existence', async () => {
    const storage = createStorage({ driver: 'memory' })
    expect(await storage.exists('file.txt')).toBe(false)
    await storage.put('file.txt', 'data')
    expect(await storage.exists('file.txt')).toBe(true)
  })

  it('deletes a file', async () => {
    const storage = createStorage({ driver: 'memory' })
    await storage.put('file.txt', 'data')
    expect(await storage.exists('file.txt')).toBe(true)
    await storage.delete('file.txt')
    expect(await storage.exists('file.txt')).toBe(false)
  })

  it('deleting a non-existent file does not throw', async () => {
    const storage = createStorage({ driver: 'memory' })
    await expect(storage.delete('nope.txt')).resolves.not.toThrow()
  })

  it('lists files', async () => {
    const storage = createStorage({ driver: 'memory' })
    await storage.put('images/a.png', 'a')
    await storage.put('images/b.png', 'b')
    await storage.put('docs/readme.md', 'r')

    const all = await storage.list()
    expect(all).toHaveLength(3)

    const images = await storage.list('images/')
    expect(images).toEqual(['images/a.png', 'images/b.png'])
  })

  it('getUrl returns memory:// URL', async () => {
    const storage = createStorage({ driver: 'memory' })
    const url = await storage.getUrl('file.txt')
    expect(url).toBe('memory://file.txt')
  })

  it('handles ReadableStream input', async () => {
    const storage = createStorage({ driver: 'memory' })
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream data'))
        controller.close()
      },
    })
    await storage.put('stream.txt', stream)
    const text = await storage.getText('stream.txt')
    expect(text).toBe('stream data')
  })
})

describe('createStorageInstance', () => {
  it('works with a custom driver', async () => {
    const driver = createMemoryDriver()
    const storage = createStorageInstance(driver)
    await storage.put('key', 'value')
    const text = await storage.getText('key')
    expect(text).toBe('value')
  })
})

// ── bytes from get() fit Response and Blob (#17) ──────────────────────────────

describe('bytes from get', () => {
  it('sit on a plain ArrayBuffer of their own, whatever put received', async () => {
    const storage = createStorageInstance(createMemoryDriver())
    const pool = Buffer.from('hello world') // Node's pool: a view with an offset into a shared slab
    const view = new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)
    const shared = new Uint8Array(new SharedArrayBuffer(3))
    shared.set([7, 8, 9])
    await storage.put('pool', pool)
    await storage.put('view', view)
    await storage.put('shared', shared)

    for (const key of ['pool', 'view', 'shared']) {
      const bytes = await storage.get(key)
      expect(bytes).not.toBeNull()
      expect(bytes!.buffer).toBeInstanceOf(ArrayBuffer)
      expect(bytes!.byteOffset).toBe(0)
      expect(bytes!.byteLength).toBe(bytes!.buffer.byteLength)
    }
    expect(Array.from((await storage.get('view'))!)).toEqual([2, 3, 4])
    expect(Array.from((await storage.get('shared'))!)).toEqual([7, 8, 9])

    view.fill(0) // the stored copy does not follow the caller's view
    expect(Array.from((await storage.get('view'))!)).toEqual([2, 3, 4])
  })

  it('go straight into Response and Blob (type-checked here, strict)', async () => {
    const storage = createStorageInstance(createMemoryDriver())
    await storage.put('a.txt', 'hi')
    const bytes = await storage.get('a.txt')
    if (bytes === null) throw new Error('missing')
    expect(await new Response(bytes).text()).toBe('hi')
    expect(new Blob([bytes]).size).toBe(2)
  })
})
