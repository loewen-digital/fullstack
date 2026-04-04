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
