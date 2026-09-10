import type { SessionConfig } from '../config/types.js'

export type { SessionConfig }

export interface SessionData {
  [key: string]: unknown
}

/** What a stateless driver's `parse` gives back: the session as `serialize` wrote it. */
export interface SessionPayload {
  id: string
  data: SessionData
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
  /**
   * Stateless drivers only (cookie): encode id and data into the value the adapter
   * stores in the session cookie. Drivers with a store leave `serialize` and `parse`
   * out; the cookie then carries only the id.
   */
  serialize?(sessionId: string, data: SessionData): Promise<string>
  /**
   * Stateless drivers only: decode a value written by `serialize`.
   * `null` when the value is missing, unsigned, tampered or expired.
   */
  parse?(value: string): Promise<SessionPayload | null>
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
  /** Destroy the session: remove it from the driver and clear its data */
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
  /**
   * Open the session a request carries. `cookie` is the value of the session cookie:
   * the id with the memory and redis drivers, the signed payload with the cookie driver.
   * A missing or invalid value opens a fresh session.
   */
  open(cookie?: string): Promise<SessionHandle>
  /**
   * Save the handle and return the value the response's session cookie has to carry:
   * the id, or the signed payload with the cookie driver. Set the cookie when the value
   * differs from the one the request brought.
   */
  commit(handle: SessionHandle): Promise<string>
  /** The underlying driver */
  driver: SessionDriver
}
