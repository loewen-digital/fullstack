import { describe, it, expect, afterEach } from 'vite-plus/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18n } from '../index.js'
import * as entry from '../index.js'
import { loadTranslations } from '../node.js'

const directories: string[] = []

async function directoryOf(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fullstack-i18n-'))
  directories.push(directory)
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content)
  }
  return directory
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

describe('loadTranslations', () => {
  it('reads a catalog per <locale>.json', async () => {
    const directory = await directoryOf({
      'en.json': JSON.stringify({ farewell: 'Goodbye', auth: { errors: { invalid: 'Invalid' } } }),
      'de.json': JSON.stringify({ farewell: 'Tschüss' }),
    })

    expect(await loadTranslations(directory)).toEqual({
      en: { farewell: 'Goodbye', auth: { errors: { invalid: 'Invalid' } } },
      de: { farewell: 'Tschüss' },
    })
  })

  it('names a locale after the whole file name', async () => {
    const directory = await directoryOf({ 'pt-BR.json': '{"farewell":"Tchau"}' })

    expect(await loadTranslations(directory)).toEqual({ 'pt-BR': { farewell: 'Tchau' } })
  })

  it('answers what createI18n takes as messages', async () => {
    const directory = await directoryOf({
      'en.json': JSON.stringify({ greeting: 'Hello, :name!', nested: { key: 'Nested' } }),
      'de.json': JSON.stringify({ greeting: 'Hallo, :name!' }),
    })

    const i18n = createI18n({ locale: 'de', messages: await loadTranslations(directory) })

    expect(i18n.t('greeting', { name: 'Ada' })).toBe('Hallo, Ada!')
    expect(i18n.t('nested.key')).toBe('Nested')
  })

  it('skips what is no .json file, and a directory', async () => {
    const directory = await directoryOf({
      'en.json': '{"farewell":"Goodbye"}',
      'README.md': '# Translations',
      'de.json.bak': '{"farewell":"Tschüss"}',
      json: '{}',
    })
    await mkdir(join(directory, 'drafts'))

    expect(await loadTranslations(directory)).toEqual({ en: { farewell: 'Goodbye' } })
  })

  it('answers no catalog for a directory without one', async () => {
    expect(await loadTranslations(await directoryOf({}))).toEqual({})
  })

  it('fails for a file that is not JSON, and for a directory that is not there', async () => {
    const directory = await directoryOf({ 'en.json': '{"farewell": ' })

    await expect(loadTranslations(directory)).rejects.toThrow(SyntaxError)
    await expect(loadTranslations(join(directory, 'missing'))).rejects.toThrow(/ENOENT/)
  })
})

describe('the i18n entry', () => {
  it('leaves loadTranslations to the entry for Node', () => {
    expect(Object.keys(entry)).toEqual(['createI18n'])
  })
})
