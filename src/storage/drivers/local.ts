import type { StorageDriver, FileMeta } from '../types.js'
import { StorageError } from '../../errors/http-errors.js'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'

export interface LocalDriverOptions {
  /** Root directory for file storage */
  root: string
  /** Base URL for generating public URLs (e.g. '/uploads') */
  baseUrl?: string
}

/**
 * Local filesystem storage driver.
 */
export function createLocalDriver(options: LocalDriverOptions): StorageDriver {
  const root = options.root
  const baseUrl = options.baseUrl ?? '/storage'

  function fullPath(key: string): string {
    // Prevent path traversal
    const normalized = key.replace(/\.\./g, '').replace(/^\/+/, '')
    return join(root, normalized)
  }

  return {
    async get(key: string): Promise<Uint8Array | null> {
      try {
        const buffer = await fs.readFile(fullPath(key))
        return new Uint8Array(buffer)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw new StorageError(`Failed to read file "${key}": ${(err as Error).message}`)
      }
    },

    async put(key: string, data: Uint8Array | string | ReadableStream, _meta: FileMeta = {}): Promise<void> {
      const path = fullPath(key)
      await fs.mkdir(dirname(path), { recursive: true })
      const bytes = await toBytes(data)
      await fs.writeFile(path, bytes)
    },

    async delete(key: string): Promise<void> {
      try {
        await fs.unlink(fullPath(key))
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new StorageError(`Failed to delete file "${key}": ${(err as Error).message}`)
        }
      }
    },

    async exists(key: string): Promise<boolean> {
      try {
        await fs.access(fullPath(key))
        return true
      } catch {
        return false
      }
    },

    async list(prefix?: string): Promise<string[]> {
      try {
        return await listRecursive(root, prefix ?? '')
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw new StorageError(`Failed to list files: ${(err as Error).message}`)
      }
    },

    async getUrl(key: string): Promise<string> {
      return `${baseUrl}/${key}`
    },
  }
}

async function listRecursive(root: string, prefix: string): Promise<string[]> {
  const results: string[] = []
  const dir = prefix ? join(root, prefix) : root

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // If exact prefix dir doesn't exist, list from root and filter
    entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      const rel = String(entry.name)
      if (entry.isFile() && rel.startsWith(prefix)) {
        results.push(rel)
      } else if (entry.isDirectory()) {
        const sub = await listRecursive(root, rel)
        results.push(...sub.filter(f => f.startsWith(prefix)))
      }
    }
    return results.sort()
  }

  for (const entry of entries) {
    const name = String(entry.name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (entry.isFile()) {
      results.push(rel)
    } else if (entry.isDirectory()) {
      const sub = await listRecursive(root, rel)
      results.push(...sub)
    }
  }
  return results.sort()
}

async function toBytes(data: Uint8Array | string | ReadableStream): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  const reader = (data as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.byteLength
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
