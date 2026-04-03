import type { SessionConfig } from '../config/types.js'

export type { SessionConfig }

export interface SessionData {
  [key: string]: unknown
}

export interface SessionDriver {
  /** Read the session data for the given session id */
  read(sessionId: string): Promise<SessionData>
  /** Write (overwrite) the session data for the given session id */
  write(sessionId: string, data: SessionData, ttl?: number): Promise<void>
  /** Destroy the session */
  destroy(sessionId: string): Promise<void>
  /** Generate a fresh session id */
  generateId(): string
}

export interface SessionHandle {
  /** Unique session identifier */
  id: string
  /** Get a value from the session */
  get<T = unknown>(key: string): T | undefined
  /** Set a value in the session */
  set(key: string, value: unknown): void
  /** Remove a value from the session */
  forget(key: string): void
  /** Regenerate the session id (for security after login) */
  regenerate(): Promise<void>
  /** Destroy the session entirely */
  destroy(): Promise<void>
  /** Persist the session to the driver */
  save(): Promise<void>
  /** Flash a value (available on the next request only) */
  flash(key: string, value: unknown): void
  /** Get a flashed value */
  getFlash<T = unknown>(key: string): T | undefined
  /** Store form input for retrieval on the next request */
  flashInput(data: Record<string, unknown>): void
  /** Get previously flashed form input */
  getOldInput<T = unknown>(key: string): T | undefined
}

export interface SessionManager {
  /** Create or resume a session from the given session id (or generate a new one) */
  load(sessionId?: string): Promise<SessionHandle>
  /** The underlying driver */
  driver: SessionDriver
}
