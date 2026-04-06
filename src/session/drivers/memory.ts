import type { SessionDriver, SessionData } from '../types.js'

interface MemoryEntry {
  data: SessionData
  expiresAt: number
}

/**
 * In-memory session driver.
 * Sessions are stored in a Map — useful for development and testing.
 * Data is lost when the process restarts.
 */
export function createMemoryDriver(defaultTtl = 7200): SessionDriver {
  const store = new Map<string, MemoryEntry>()

  function cleanExpired(): void {
    const now = Date.now()
    for (const [id, entry] of store) {
      if (entry.expiresAt <= now) store.delete(id)
    }
  }

  return {
    generateId(): string {
      return crypto.randomUUID()
    },

    async read(sessionId: string): Promise<SessionData> {
      cleanExpired()
      const entry = store.get(sessionId)
      if (!entry || entry.expiresAt <= Date.now()) return {}
      return { ...entry.data }
    },

    async write(sessionId: string, data: SessionData, ttl?: number): Promise<void> {
      const seconds = ttl ?? defaultTtl
      store.set(sessionId, { data: { ...data }, expiresAt: Date.now() + seconds * 1000 })
    },

    async destroy(sessionId: string): Promise<void> {
      store.delete(sessionId)
    },
  }
}

