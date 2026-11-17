import { describe, it, expect } from 'vite-plus/test'
import { negotiateLocale } from '../index.js'

const LOCALES = ['en', 'de'] as const

describe('negotiateLocale', () => {
  it('answers the first language of the header the app speaks', () => {
    expect(negotiateLocale('de', LOCALES)).toBe('de')
    expect(negotiateLocale('en-US,en;q=0.9', LOCALES)).toBe('en')
    expect(negotiateLocale('fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7', LOCALES)).toBe('de')
    expect(negotiateLocale('de,en', LOCALES)).toBe('de')
    expect(negotiateLocale('en,de', LOCALES)).toBe('en')
  })

  it('goes by the weights before the order of writing', () => {
    expect(negotiateLocale('en;q=0.5,de;q=0.9', LOCALES)).toBe('de')
    expect(negotiateLocale('de;q=0.8, en', LOCALES)).toBe('en')
    expect(negotiateLocale('de;q=0.8,en;q=1.0', LOCALES)).toBe('en')
    expect(negotiateLocale('de;q=0.123,en;q=0.124', LOCALES)).toBe('en')
    expect(negotiateLocale('fr;q=1,de;q=0.001,en;q=0.', LOCALES)).toBe('de')
  })

  it('goes by the order of the header among equal weights', () => {
    expect(negotiateLocale('de;q=0.7,en;q=0.7', LOCALES)).toBe('de')
    expect(negotiateLocale('en;q=0.7,de;q=0.7', LOCALES)).toBe('en')
    expect(negotiateLocale('fr;q=0.9,en;q=0.5,es;q=0.9,de;q=0.5', LOCALES)).toBe('en')
  })

  it('leaves out a language with q=0', () => {
    expect(negotiateLocale('de;q=0,en;q=0.1', LOCALES)).toBe('en')
    expect(negotiateLocale('de;q=0', LOCALES)).toBeUndefined()
    expect(negotiateLocale('de;q=0.000,en;q=0.0', LOCALES)).toBeUndefined()
  })

  it('leaves out the wildcard', () => {
    expect(negotiateLocale('*', LOCALES)).toBeUndefined()
    expect(negotiateLocale('*;q=0.5', LOCALES)).toBeUndefined()
    expect(negotiateLocale('fr,*;q=0.5', LOCALES)).toBeUndefined()
    expect(negotiateLocale('*,de;q=0.5', LOCALES)).toBe('de')
    expect(negotiateLocale('*', ['*', 'en'])).toBeUndefined()
  })

  it('takes a region the app does not speak as its language', () => {
    expect(negotiateLocale('de-CH', LOCALES)).toBe('de')
    expect(negotiateLocale('de-CH,de;q=0.9,en;q=0.8', LOCALES)).toBe('de')
    expect(negotiateLocale('en-GB;q=0.9,de-AT;q=0.8', LOCALES)).toBe('en')
    expect(negotiateLocale('zh-Hant-TW', ['zh', 'en'])).toBe('zh')
    expect(negotiateLocale('zh-Hant-TW', ['zh', 'zh-Hant'])).toBe('zh-Hant')
  })

  it('prefers the locale that says exactly what was asked for', () => {
    expect(negotiateLocale('de-CH', ['de', 'de-CH'])).toBe('de-CH')
    expect(negotiateLocale('de', ['de-CH', 'de'])).toBe('de')
    expect(negotiateLocale('pt-BR', ['pt', 'pt-PT', 'pt-BR'])).toBe('pt-BR')
  })

  it('takes a locale with a region for its language', () => {
    expect(negotiateLocale('de', ['en-US', 'de-DE'])).toBe('de-DE')
    expect(negotiateLocale('en', ['en-GB', 'en-US'])).toBe('en-GB')
    expect(negotiateLocale('en', ['en-US', 'en-GB'])).toBe('en-US')
    // The same language from elsewhere, rather than none of it.
    expect(negotiateLocale('de-CH', ['en-US', 'de-DE'])).toBe('de-DE')
    expect(negotiateLocale('zh-Hant-TW', ['zh-Hans-CN', 'zh-Hant-HK'])).toBe('zh-Hant-HK')
    expect(negotiateLocale('de-CH,en;q=0.9', ['en', 'de-DE'])).toBe('de-DE')
  })

  it('matches whole parts of a tag only', () => {
    expect(negotiateLocale('de', ['deu', 'den-DE'])).toBeUndefined()
    expect(negotiateLocale('deu', ['de'])).toBeUndefined()
    expect(negotiateLocale('en-US', ['en-USA', 'en-US-posix'])).toBe('en-US-posix')
    expect(negotiateLocale('en-US', ['enx', 'en-USA'])).toBe('en-USA')
  })

  it('drops a single letter together with the part it opens', () => {
    expect(negotiateLocale('de-x-inside', ['de-x-other', 'de'])).toBe('de')
    expect(negotiateLocale('de-DE-u-co-phonebk', ['de-AT', 'de-DE'])).toBe('de-DE')
    expect(negotiateLocale('x-private', ['x', 'en'])).toBeUndefined()
    expect(negotiateLocale('a-b-c-d-e', ['a', 'a-b', 'a-b-c'])).toBeUndefined()
  })

  it('reads a tag of up to 35 characters', () => {
    const longest = 'de-abcdefgh-abcdefgh-abcdefgh-abcde'
    expect(longest).toHaveLength(35)

    expect(negotiateLocale(longest, LOCALES)).toBe('de')
    expect(negotiateLocale(`${longest}f`, LOCALES)).toBeUndefined()
    expect(negotiateLocale(`${longest}f,en;q=0.1`, LOCALES)).toBe('en')
    expect(negotiateLocale('de-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a-a', LOCALES)).toBe('de')
  })

  it('reads tags without regard to case and answers as the app writes them', () => {
    expect(negotiateLocale('DE-de', LOCALES)).toBe('de')
    expect(negotiateLocale('PT-br', ['pt-BR'])).toBe('pt-BR')
    expect(negotiateLocale('pt-BR', ['PT-br'])).toBe('PT-br')
    expect(negotiateLocale('EN;Q=0.5,DE;Q=0.9', LOCALES)).toBe('de')
  })

  it('reads the header of a request', () => {
    const request = new Request('https://app.example/', {
      headers: { 'Accept-Language': 'fr-CH, fr;q=0.9, de;q=0.8, en;q=0.7, *;q=0.5' },
    })

    expect(negotiateLocale(request, LOCALES)).toBe('de')
    expect(negotiateLocale(new Request('https://app.example/'), LOCALES)).toBeUndefined()
  })

  it('answers nothing without a language the app speaks', () => {
    expect(negotiateLocale(null, LOCALES)).toBeUndefined()
    expect(negotiateLocale(undefined, LOCALES)).toBeUndefined()
    expect(negotiateLocale('', LOCALES)).toBeUndefined()
    expect(negotiateLocale(' , ,', LOCALES)).toBeUndefined()
    expect(negotiateLocale('fr,es;q=0.9', LOCALES)).toBeUndefined()
    expect(negotiateLocale('de', [])).toBeUndefined()
  })

  it('reads the spaces a header may carry', () => {
    expect(negotiateLocale('  fr , de ; q=0.5 ,\ten\t;\tq=0.4', LOCALES)).toBe('de')
    expect(negotiateLocale('de;q=0.5 , en;q=0.9 ', LOCALES)).toBe('en')
  })

  it.each([
    ['a weight that is no number', 'de;q=nonsense'],
    ['a weight above one', 'de;q=2'],
    ['a weight just above one', 'de;q=1.001'],
    ['a weight below zero', 'de;q=-1'],
    ['a weight without a value', 'de;q='],
    ['a weight written apart', 'de;q = 0.5'],
    ['a parameter that is no weight', 'de;level=1'],
    ['a weight after another parameter', 'de;level=1;q=0.5'],
    ['two weights', 'de;q=0.5;q=0.9'],
    ['a weight without a language', ';q=0.5'],
    ['an underscore in the tag', 'de_DE'],
    ['a tag that starts with a digit', '1de'],
    ['a part of more than eight characters', 'de-abcdefghi'],
    ['an empty part', 'de--CH'],
    ['a tag that ends in a hyphen', 'de-'],
    ['two tags in one entry', 'de en'],
  ])('skips an entry with %s', (_what, entry) => {
    expect(negotiateLocale(entry, ['de', 'de-DE', 'de-CH', 'en'])).toBeUndefined()
    // Not even for an app that names a locale the way the entry is written.
    expect(negotiateLocale(entry, [entry.split(';')[0]!.trim()])).toBeUndefined()
    // What stands next to it still counts.
    expect(negotiateLocale(`${entry},en;q=0.1`, ['de', 'de-DE', 'de-CH', 'en'])).toBe('en')
    expect(negotiateLocale(`en;q=0.1,${entry}`, ['de', 'de-DE', 'de-CH', 'en'])).toBe('en')
  })

  it('reads a header of any length', () => {
    const noise = Array.from({ length: 20_000 }, (_, index) => `x${index % 97}-y${index};q=0.9`)
    const header = [...noise, 'de;q=0.2', 'en;q=0.3'].join(',')

    expect(negotiateLocale(header, LOCALES)).toBe('en')
    expect(negotiateLocale(`${'a-'.repeat(50_000)}a,de`, LOCALES)).toBe('de')
    expect(negotiateLocale(`${'de;'.repeat(50_000)}q=1,en`, LOCALES)).toBe('en')
  })

  it('answers one of the locales it was given, as a type too', () => {
    // Checked by the type check: the answer is no wider than the list.
    const fromList: 'en' | 'de' | undefined = negotiateLocale('de', LOCALES)
    const fromLiteral: 'fr' | 'it' | undefined = negotiateLocale('it', ['fr', 'it'])
    const loaded: string[] = ['en', 'de']
    const fromStrings: string | undefined = negotiateLocale('de', loaded)

    expect([fromList, fromLiteral, fromStrings]).toEqual(['de', 'it', 'de'])
  })
})
