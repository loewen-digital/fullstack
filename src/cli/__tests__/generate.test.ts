import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// We test the generate functions by temporarily changing cwd
let tmpDir: string
let originalCwd: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fullstack-cli-test-'))
  originalCwd = process.cwd()
  process.chdir(tmpDir)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateFactory', () => {
  it('creates a factory file', async () => {
    const { generateFactory } = await import('../generate.js')
    generateFactory('user')

    const filePath = join(tmpDir, 'database', 'factories', 'user.factory.ts')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('UserFactory')
    expect(content).toContain('defineFactory')
  })

  it('exits if name is empty', async () => {
    const { generateFactory } = await import('../generate.js')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    expect(() => generateFactory('')).toThrow('exit')
    exitSpy.mockRestore()
  })

  it('exits if file already exists', async () => {
    const { generateFactory } = await import('../generate.js')
    generateFactory('post')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    expect(() => generateFactory('post')).toThrow('exit')
    exitSpy.mockRestore()
  })
})

describe('generateSeed', () => {
  it('creates a seed file', async () => {
    const { generateSeed } = await import('../generate.js')
    generateSeed('users')

    const filePath = join(tmpDir, 'database', 'seeds', 'users.seed.ts')
    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('export default async function seed')
    expect(content).toContain('DbInstance')
  })

  it('exits if name is empty', async () => {
    const { generateSeed } = await import('../generate.js')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    expect(() => generateSeed('')).toThrow('exit')
    exitSpy.mockRestore()
  })
})
