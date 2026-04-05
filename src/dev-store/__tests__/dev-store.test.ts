import { describe, it, expect, beforeEach } from 'vitest'
import {
  devStorePushMail,
  devStoreGetMail,
  devStoreClearMail,
  devStorePushJob,
  devStoreGetJobs,
  devStoreClearJobs,
  devStorePushLog,
  devStoreGetLogs,
  devStoreClearLogs,
  devStoreRegisterCache,
  devStoreUnregisterCache,
  devStoreGetCacheEntries,
  devStoreClearAll,
} from '../index.js'

beforeEach(() => {
  devStoreClearAll()
})

// ── Mail ─────────────────────────────────────────────────────────────────────

describe('mail store', () => {
  it('stores and retrieves mail entries', () => {
    devStorePushMail({ timestamp: '2024-01-01T00:00:00Z', to: 'a@b.com', subject: 'Hello', from: 'x@y.com' })
    const entries = devStoreGetMail()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.subject).toBe('Hello')
    expect(entries[0]!.to).toBe('a@b.com')
  })

  it('stores most-recent first (unshift)', () => {
    devStorePushMail({ timestamp: '2024-01-01T00:00:00Z', to: 'a@b.com', subject: 'First', from: '' })
    devStorePushMail({ timestamp: '2024-01-01T00:00:01Z', to: 'a@b.com', subject: 'Second', from: '' })
    expect(devStoreGetMail()[0]!.subject).toBe('Second')
  })

  it('returns a copy (mutations do not affect store)', () => {
    devStorePushMail({ timestamp: '2024-01-01T00:00:00Z', to: 'a@b.com', subject: 'Test', from: '' })
    const entries = devStoreGetMail()
    entries.pop()
    expect(devStoreGetMail()).toHaveLength(1)
  })

  it('assigns a unique id to each entry', () => {
    devStorePushMail({ timestamp: '2024-01-01T00:00:00Z', to: 'a@b.com', subject: 'A', from: '' })
    devStorePushMail({ timestamp: '2024-01-01T00:00:01Z', to: 'a@b.com', subject: 'B', from: '' })
    const [b, a] = devStoreGetMail()
    expect(b!.id).not.toBe(a!.id)
  })

  it('clears all mail entries', () => {
    devStorePushMail({ timestamp: '2024-01-01T00:00:00Z', to: 'a@b.com', subject: 'Test', from: '' })
    devStoreClearMail()
    expect(devStoreGetMail()).toHaveLength(0)
  })
})

// ── Queue ────────────────────────────────────────────────────────────────────

describe('queue store', () => {
  it('stores and retrieves job entries', () => {
    devStorePushJob({
      name: 'SendEmail',
      payload: { userId: 1 },
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      enqueuedAt: new Date().toISOString(),
    })
    const jobs = devStoreGetJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.name).toBe('SendEmail')
    expect(jobs[0]!.status).toBe('pending')
  })

  it('clears all jobs', () => {
    devStorePushJob({ name: 'X', payload: {}, status: 'pending', attempts: 0, maxAttempts: 1, enqueuedAt: '' })
    devStoreClearJobs()
    expect(devStoreGetJobs()).toHaveLength(0)
  })
})

// ── Logs ─────────────────────────────────────────────────────────────────────

describe('log store', () => {
  it('stores and retrieves log entries', () => {
    devStorePushLog({ level: 'info', message: 'App started', timestamp: new Date().toISOString() })
    devStorePushLog({ level: 'error', message: 'Something broke', timestamp: new Date().toISOString(), context: { code: 500 } })
    const logs = devStoreGetLogs()
    expect(logs).toHaveLength(2)
    expect(logs[0]!.level).toBe('error') // most recent first
    expect(logs[0]!.context).toEqual({ code: 500 })
  })

  it('clears all logs', () => {
    devStorePushLog({ level: 'warn', message: 'Test', timestamp: '' })
    devStoreClearLogs()
    expect(devStoreGetLogs()).toHaveLength(0)
  })
})

// ── Cache ─────────────────────────────────────────────────────────────────────

describe('cache store', () => {
  it('collects entries from registered snapshotter', () => {
    const snapshot = () => [
      { key: 'user:1', value: { name: 'Alice' }, expiresAt: null },
      { key: 'user:2', value: { name: 'Bob' }, expiresAt: Date.now() + 60000 },
    ]
    devStoreRegisterCache(snapshot)
    const entries = devStoreGetCacheEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.key).toBe('user:1')
    devStoreUnregisterCache(snapshot)
  })

  it('combines entries from multiple snapshotters', () => {
    const s1 = () => [{ key: 'a', value: 1, expiresAt: null }]
    const s2 = () => [{ key: 'b', value: 2, expiresAt: null }]
    devStoreRegisterCache(s1)
    devStoreRegisterCache(s2)
    expect(devStoreGetCacheEntries()).toHaveLength(2)
    devStoreUnregisterCache(s1)
    devStoreUnregisterCache(s2)
  })

  it('unregisters snapshotter', () => {
    const snapshot = () => [{ key: 'x', value: 'y', expiresAt: null }]
    devStoreRegisterCache(snapshot)
    devStoreUnregisterCache(snapshot)
    expect(devStoreGetCacheEntries()).toHaveLength(0)
  })
})

// ── clearAll ─────────────────────────────────────────────────────────────────

describe('devStoreClearAll', () => {
  it('clears mail, jobs, and logs', () => {
    devStorePushMail({ timestamp: '', to: '', subject: '', from: '' })
    devStorePushJob({ name: 'X', payload: {}, status: 'pending', attempts: 0, maxAttempts: 1, enqueuedAt: '' })
    devStorePushLog({ level: 'info', message: 'hi', timestamp: '' })
    devStoreClearAll()
    expect(devStoreGetMail()).toHaveLength(0)
    expect(devStoreGetJobs()).toHaveLength(0)
    expect(devStoreGetLogs()).toHaveLength(0)
  })
})
