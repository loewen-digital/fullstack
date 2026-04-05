import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fullstack-migrate-test-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  vi.resetModules()
})

/** Create a minimal Drizzle migrations folder that passes the journal check */
function createEmptyMigrationsFolder(dir: string): string {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }),
    'utf-8',
  )
  return dir
}

describe('migrateRun', () => {
  it('runs against a sqlite db with an empty migrations folder', async () => {
    const migrationsDir = createEmptyMigrationsFolder(join(tmpDir, 'migrations'))

    vi.doMock('../../config/index.js', () => ({
      loadConfig: async () => ({ db: { driver: 'sqlite', url: join(tmpDir, 'test.db') } }),
    }))

    const { migrateRun } = await import('../migrate.js')
    await expect(migrateRun(migrationsDir)).resolves.not.toThrow()
  })

  it('exits when no db config is present', async () => {
    vi.doMock('../../config/index.js', () => ({
      loadConfig: async () => ({}),
    }))

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit') }) as never)

    const { migrateRun } = await import('../migrate.js')
    await expect(migrateRun()).rejects.toThrow('exit')

    exitSpy.mockRestore()
  })
})

describe('migrateStatus', () => {
  it('reports no migrations when db is fresh', async () => {
    vi.doMock('../../config/index.js', () => ({
      loadConfig: async () => ({ db: { driver: 'sqlite', url: join(tmpDir, 'status.db') } }),
    }))

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { migrateStatus } = await import('../migrate.js')
    await migrateStatus()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No migrations'))
    consoleSpy.mockRestore()
  })
})

describe('migrateRollback', () => {
  it('runs without error on a fresh db (no migrations table yet)', async () => {
    vi.doMock('../../config/index.js', () => ({
      loadConfig: async () => ({ db: { driver: 'sqlite', url: join(tmpDir, 'rollback.db') } }),
    }))

    const { migrateRollback } = await import('../migrate.js')
    await expect(migrateRollback()).resolves.not.toThrow()
  })
})
