import type { CacheConfig } from '../config/types.js'

export type { CacheConfig }

export interface CacheDriver {
  /** Get a value by key, or null if not found / expired */
  get<T = unknown>(key: string): Promise<T | null>
  /** Set a value with optional TTL in seconds */
  set(key: string, value: unknown, ttl?: number): Promise<void>
  /** Check if a key exists (and is not expired) */
  has(key: string): Promise<boolean>
  /** Delete a key */
  delete(key: string): Promise<boolean>
  /** Delete all keys */
  flush(): Promise<void>
}

export interface CacheInstance {
  /** Get a value by key, or null if not found */
  get<T = unknown>(key: string): Promise<T | null>
  /** Set a value with optional TTL in seconds */
  set(key: string, value: unknown, ttl?: number): Promise<void>
  /** Check if a key exists */
  has(key: string): Promise<boolean>
  /** Delete a key */
  delete(key: string): Promise<boolean>
  /** Delete all keys */
  flush(): Promise<void>
  /** Get or compute and store a value */
  remember<T>(key: string, ttl: number, fn: () => T | Promise<T>): Promise<T>
}
