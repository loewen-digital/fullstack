/**
 * Global in-memory store for dev UI data.
 *
 * This singleton is written to by dev-mode drivers (console mail, memory
 * queue, console log transport, memory cache) and read by the Vite plugin
 * middleware to power the /__fullstack/ Dev UI.
 *
 * Only active when NODE_ENV !== 'production'.
 */

export interface DevMailEntry {
  id: string
  timestamp: string
  to: string
  subject: string
  from: string
  cc?: string
  bcc?: string
  text?: string
  html?: string
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface DevJobEntry {
  id: string
  name: string
  payload: unknown
  status: JobStatus
  attempts: number
  maxAttempts: number
  enqueuedAt: string
  failedReason?: string
}

export interface DevLogEntry {
  id: string
  level: string
  message: string
  timestamp: string
  context?: Record<string, unknown>
}

export interface DevCacheEntry {
  key: string
  value: unknown
  expiresAt: number | null
}

type CacheSnapshot = () => DevCacheEntry[]

const MAX_ENTRIES = 500

const mailStore: DevMailEntry[] = []
const jobStore: DevJobEntry[] = []
const logStore: DevLogEntry[] = []
const cacheSnapshotters: CacheSnapshot[] = []

let idCounter = 0
function nextId(): string {
  return String(++idCounter)
}

// ─── Mail ────────────────────────────────────────────────────────────────────

export function devStorePushMail(entry: Omit<DevMailEntry, 'id'>): void {
  mailStore.unshift({ ...entry, id: nextId() })
  if (mailStore.length > MAX_ENTRIES) mailStore.pop()
}

export function devStoreGetMail(): DevMailEntry[] {
  return [...mailStore]
}

export function devStoreClearMail(): void {
  mailStore.length = 0
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export function devStorePushJob(entry: Omit<DevJobEntry, 'id'>): void {
  jobStore.unshift({ ...entry, id: nextId() })
  if (jobStore.length > MAX_ENTRIES) jobStore.pop()
}

export function devStoreUpdateJob(jobId: string, patch: Partial<DevJobEntry>): void {
  const idx = jobStore.findIndex((j) => j.id === jobId)
  if (idx !== -1) Object.assign(jobStore[idx]!, patch)
}

export function devStoreGetJobs(): DevJobEntry[] {
  return [...jobStore]
}

export function devStoreClearJobs(): void {
  jobStore.length = 0
}

// ─── Logs ────────────────────────────────────────────────────────────────────

export function devStorePushLog(entry: Omit<DevLogEntry, 'id'>): void {
  logStore.unshift({ ...entry, id: nextId() })
  if (logStore.length > MAX_ENTRIES) logStore.pop()
}

export function devStoreGetLogs(): DevLogEntry[] {
  return [...logStore]
}

export function devStoreClearLogs(): void {
  logStore.length = 0
}

// ─── Cache ───────────────────────────────────────────────────────────────────

/** Called by the memory cache driver to register a snapshot function */
export function devStoreRegisterCache(fn: CacheSnapshot): void {
  cacheSnapshotters.push(fn)
}

export function devStoreUnregisterCache(fn: CacheSnapshot): void {
  const idx = cacheSnapshotters.indexOf(fn)
  if (idx !== -1) cacheSnapshotters.splice(idx, 1)
}

export function devStoreGetCacheEntries(): DevCacheEntry[] {
  return cacheSnapshotters.flatMap((fn) => fn())
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function devStoreClearAll(): void {
  devStoreClearMail()
  devStoreClearJobs()
  devStoreClearLogs()
  cacheSnapshotters.length = 0
}

export function isDevMode(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
}
