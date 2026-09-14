import type { StorageConfig } from '../config/types.js'

export type { StorageConfig }

export interface FileMeta {
  contentType?: string
  contentLength?: number
  lastModified?: Date
  [key: string]: unknown
}

export interface StorageDriver {
  /**
   * A file's contents, or null when missing. The bytes sit on a plain `ArrayBuffer` of their own,
   * so they go straight into `new Response(bytes)` and `new Blob([bytes])`.
   */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  /** Store a file */
  put(key: string, data: Uint8Array | string | ReadableStream, meta?: FileMeta): Promise<void>
  /** Delete a file */
  delete(key: string): Promise<void>
  /** Check if a file exists */
  exists(key: string): Promise<boolean>
  /** List files by prefix */
  list(prefix?: string): Promise<string[]>
  /** Get a URL for the file */
  getUrl(key: string): Promise<string>
}

export interface StorageInstance {
  /** Get a file's contents */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>
  /** Get a file's contents as a UTF-8 string */
  getText(key: string): Promise<string | null>
  /** Store a file */
  put(key: string, data: Uint8Array | string | ReadableStream, meta?: FileMeta): Promise<void>
  /** Delete a file */
  delete(key: string): Promise<void>
  /** Check if a file exists */
  exists(key: string): Promise<boolean>
  /** List files by prefix */
  list(prefix?: string): Promise<string[]>
  /** Get a public URL for the file */
  getUrl(key: string): Promise<string>
}
