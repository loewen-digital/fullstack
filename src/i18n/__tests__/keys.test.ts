import { describe, it, expect, vi } from 'vite-plus/test'
import { createI18n, missingKeys } from '../index.js'
import type { I18nInstance, MessageKey, Messages } from '../index.js'

const messages = {
  en: {
    title: 'Notes',
    greeting: 'Hello, :name!',
    notes: 'no notes|one note|:count notes',
    auth: { errors: { invalid: 'Invalid email or password.', locked: 'Locked.' } },
    'billing.plan': 'Plan',
    status: { 404: 'Not found' },
    steps: ['First', 'Then'],
  },
  de: {
    title: 'Notizen',
    greeting: 'Hallo, :name!',
    auth: { errors: { invalid: 'E-Mail oder Passwort stimmt nicht.' } },
    onlyGerman: 'Nur hier',
  },
}

/** Catalogs whose names the type checker does not know, as `loadTranslations` answers them */
function loaded(): Messages {
  return JSON.parse(JSON.stringify(messages)) as Messages
}

describe('the keys t and tn take', () => {
  it('are the ones a catalog has a text for, nested ones joined by dots', () => {
    const i18n = createI18n({ locale: 'en', messages })

    expect(i18n.t('title')).toBe('Notes')
    expect(i18n.t('auth.errors.invalid')).toBe('Invalid email or password.')
    expect(i18n.t('billing.plan')).toBe('Plan')
    expect(i18n.t('status.404')).toBe('Not found')
    expect(i18n.t('steps.1')).toBe('Then')
    expect(i18n.tn('notes', 3)).toBe('3 notes')
    expect(i18n.t('greeting', { name: 'Ada' })).toBe('Hello, Ada!')
  })

  it('are the keys of every locale together', () => {
    const i18n = createI18n({ locale: 'de', fallback: 'en', messages })

    // A text only the fallback has, and one only the active locale has.
    expect(i18n.t('auth.errors.locked')).toBe('Locked.')
    expect(i18n.t('onlyGerman')).toBe('Nur hier')
  })

  it('refuse a key no catalog has, when the code is checked', () => {
    const i18n = createI18n({ locale: 'en', messages })

    // @ts-expect-error a typo
    expect(i18n.t('titel')).toBe('titel')
    // @ts-expect-error a group is no text
    expect(i18n.t('auth.errors')).toBe('auth.errors')
    // @ts-expect-error the name of a group alone
    expect(i18n.t('auth')).toBe('auth')
    // @ts-expect-error a key that goes on below a text
    expect(i18n.t('title.short')).toBe('title.short')
    // @ts-expect-error the locale is no part of a key
    expect(i18n.t('en.title')).toBe('en.title')
    // @ts-expect-error a typo, in tn as well
    expect(i18n.tn('note', 2)).toBe('note')
  })

  it('are any string for catalogs that were loaded at runtime', () => {
    const i18n = createI18n({ locale: 'en', messages: loaded() })
    const key: string = ['auth', 'errors', 'invalid'].join('.')

    expect(i18n.t(key)).toBe('Invalid email or password.')
    expect(i18n.t('no.such.key')).toBe('no.such.key')
    expect(i18n.tn('notes', 1)).toBe('one note')
  })

  it('are any string without messages, and for a config that is not written in place', () => {
    const config: { locale: string; messages?: Messages } = { locale: 'de' }

    expect(createI18n().t('anything')).toBe('anything')
    expect(createI18n({ locale: 'de' }).t('anything')).toBe('anything')
    expect(createI18n(config).t('anything')).toBe('anything')
  })

  it('are known for catalogs that are declared apart and for ones marked as const', () => {
    const en = { title: 'Notes', nested: { deep: { text: 'Deep' } } }
    const fixed = { en: { title: 'Notes', list: ['a', 'b'] } } as const

    const i18n = createI18n({ messages: { en } })
    expect(i18n.t('nested.deep.text')).toBe('Deep')
    // @ts-expect-error not a key of the catalog
    expect(i18n.t('nested.deep')).toBe('nested.deep')

    const constant = createI18n({ messages: fixed })
    expect(constant.t('list.0')).toBe('a')
    // @ts-expect-error not a key of the catalog
    expect(constant.t('lists.0')).toBe('lists.0')
  })

  it('leave an instance usable where any string is a key', () => {
    const typed = createI18n({ locale: 'en', messages })
    const plain: I18nInstance = typed
    const dynamic = `auth.errors.${'locked'}`

    expect(plain.t(dynamic)).toBe('Locked.')
  })

  it('are a type an app can name', () => {
    type Key = MessageKey<(typeof messages)[keyof typeof messages]>
    const keys: Key[] = ['title', 'auth.errors.locked', 'onlyGerman', 'billing.plan', 'status.404']
    // @ts-expect-error not a key of any catalog
    const wrong: Key = 'auth.errors.unknown'
    const anyString: MessageKey<Record<string, unknown>> = 'whatever.it.is'

    const i18n = createI18n({ locale: 'en', fallback: 'de', messages })
    expect(keys.map((key) => i18n.t(key))).toEqual([
      'Notes',
      'Locked.',
      'Nur hier',
      'Plan',
      'Not found',
    ])
    expect([wrong, anyString]).toHaveLength(2)
  })

  it('leave out a name the lookup never reaches', () => {
    const odd = {
      en: {
        'top.level': 'Reached',
        'top.group': { text: 'Not reached' },
        group: { 'dotted.name': 'Not reached', plain: 'Reached' },
        count: 3,
        nothing: null,
      },
    }
    const i18n = createI18n({ messages: odd })

    expect(i18n.t('top.level')).toBe('Reached')
    expect(i18n.t('group.plain')).toBe('Reached')
    // @ts-expect-error a name with a dot in it is only found at the top
    expect(i18n.t('group.dotted.name')).toBe('group.dotted.name')
    // @ts-expect-error a group under a name with a dot in it is not reached
    expect(i18n.t('top.group.text')).toBe('top.group.text')
    // @ts-expect-error a number is no text
    expect(i18n.t('count')).toBe('count')
    // @ts-expect-error null is no text
    expect(i18n.t('nothing')).toBe('nothing')
  })
})

describe('onMissing', () => {
  it('is told the key and the active locale when neither locale has a text', () => {
    const onMissing = vi.fn()
    const i18n: I18nInstance = createI18n({ locale: 'de', fallback: 'en', messages, onMissing })

    expect(i18n.t('notes.titel')).toBe('notes.titel')
    expect(onMissing).toHaveBeenCalledExactlyOnceWith('notes.titel', 'de')
  })

  it('is not told about a text the active locale or the fallback has', () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ locale: 'de', fallback: 'en', messages, onMissing })

    expect(i18n.t('title')).toBe('Notizen')
    expect(i18n.t('auth.errors.locked')).toBe('Locked.')
    expect(i18n.tn('notes', 2)).toBe('2 notes')
    expect(onMissing).not.toHaveBeenCalled()
  })

  it('is told about a key only another locale has', () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ locale: 'en', fallback: 'en', messages, onMissing })

    expect(i18n.t('onlyGerman')).toBe('onlyGerman')
    expect(onMissing).toHaveBeenCalledExactlyOnceWith('onlyGerman', 'en')
  })

  it('is told every time, by tn as well, and in the locale of the moment', () => {
    const onMissing = vi.fn()
    const i18n: I18nInstance = createI18n({ locale: 'en', messages, onMissing })

    i18n.t('gone')
    i18n.t('gone')
    i18n.locale('de')
    expect(i18n.tn('gone.too', 2, { name: 'x' })).toBe('gone.too')

    expect(onMissing.mock.calls).toEqual([
      ['gone', 'en'],
      ['gone', 'en'],
      ['gone.too', 'de'],
    ])
  })

  it('is told about a key of a locale without a catalog', () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ locale: 'fr', fallback: 'it', messages, onMissing })

    expect(i18n.t('title')).toBe('title')
    expect(onMissing).toHaveBeenCalledExactlyOnceWith('title', 'fr')
  })

  it('can throw, and what it throws leaves t', () => {
    const i18n: I18nInstance = createI18n({
      locale: 'en',
      messages,
      onMissing(key, locale) {
        throw new Error(`no text for ${key} in ${locale}`)
      },
    })

    expect(i18n.t('title')).toBe('Notes')
    expect(() => i18n.t('titel')).toThrow('no text for titel in en')
    expect(() => i18n.tn('titel', 2)).toThrow('no text for titel in en')
  })

  it('answers the key as before, with or without it', () => {
    const quiet: I18nInstance = createI18n({ locale: 'en', messages })
    const told: I18nInstance = createI18n({ locale: 'en', messages, onMissing: () => {} })

    expect(quiet.t('no.such.key', { name: 'x' })).toBe('no.such.key')
    expect(told.t('no.such.key', { name: 'x' })).toBe('no.such.key')
    expect(told.tn('no.such.key', 5)).toBe('no.such.key')
  })
})

describe('missingKeys', () => {
  it('names each key a locale lacks and another one has', () => {
    expect(missingKeys(messages)).toEqual([
      { locale: 'en', key: 'onlyGerman' },
      { locale: 'de', key: 'notes' },
      { locale: 'de', key: 'auth.errors.locked' },
      { locale: 'de', key: 'billing.plan' },
      { locale: 'de', key: 'status.404' },
      { locale: 'de', key: 'steps.0' },
      { locale: 'de', key: 'steps.1' },
    ])
  })

  it('finds nothing in catalogs that have the same keys', () => {
    expect(
      missingKeys({
        en: { title: 'Notes', auth: { errors: { invalid: 'Invalid' } } },
        de: { auth: { errors: { invalid: 'Ungültig' } }, title: 'Notizen' },
        fr: { title: 'Notes', auth: { errors: { invalid: 'Invalide' } } },
      }),
    ).toEqual([])
    expect(missingKeys({})).toEqual([])
    expect(missingKeys({ en: { title: 'Notes' } })).toEqual([])
    expect(missingKeys({ en: {}, de: {} })).toEqual([])
  })

  it('takes a key written flat and the same key written nested as one', () => {
    expect(
      missingKeys({
        en: { 'auth.errors.invalid': 'Invalid', 'auth.title': 'Sign in' },
        de: { auth: { errors: { invalid: 'Ungültig' }, title: 'Anmelden' } },
      }),
    ).toEqual([])
  })

  it('does not take a group for a text, or a text for a group', () => {
    expect(
      missingKeys({
        en: { auth: 'Sign in' },
        de: { auth: { title: 'Anmelden' } },
      }),
    ).toEqual([
      { locale: 'en', key: 'auth.title' },
      { locale: 'de', key: 'auth' },
    ])
  })

  it('counts what t finds, and nothing else', () => {
    const odd = {
      'top.level': 'Reached',
      'top.group': { text: 'Not reached' },
      group: {
        'dotted.name': 'Not reached',
        plain: 'Reached',
        deeper: { list: ['a', { b: 'c' }] },
      },
      count: 3,
      flag: true,
      nothing: null,
      empty: {},
      blank: '',
    }
    const found = missingKeys({ odd, none: {} })

    expect(found.map((missing) => missing.locale)).toEqual(Array(found.length).fill('none'))
    expect(found.map((missing) => missing.key)).toEqual([
      'top.level',
      'group.plain',
      'group.deeper.list.0',
      'group.deeper.list.1.b',
      'blank',
    ])

    // Each of them has a text, and the names that are left out have none.
    const onMissing = vi.fn()
    const i18n: I18nInstance = createI18n({ locale: 'odd', messages: { odd }, onMissing })
    expect(found.map((missing) => i18n.t(missing.key))).toEqual([
      'Reached',
      'Reached',
      'a',
      'c',
      '',
    ])
    expect(onMissing).not.toHaveBeenCalled()
    for (const key of [
      'top.group.text',
      'group.dotted.name',
      'count',
      'flag',
      'nothing',
      'empty',
    ]) {
      expect(i18n.t(key)).toBe(key)
    }
    expect(onMissing).toHaveBeenCalledTimes(6)
  })

  it('reads catalogs that were loaded at runtime, whatever they hold', () => {
    const broken = { en: { title: 'Notes' }, de: null, fr: 'not a catalog', it: ['x'] }

    expect(missingKeys(loaded())).toEqual(missingKeys(messages))
    expect(missingKeys(broken as unknown as Messages)).toEqual([
      { locale: 'en', key: '0' },
      { locale: 'de', key: 'title' },
      { locale: 'de', key: '0' },
      { locale: 'fr', key: 'title' },
      { locale: 'fr', key: '0' },
      { locale: 'it', key: 'title' },
    ])
  })

  it('leaves a locale that is partial on purpose to a filter', () => {
    const regional = {
      de: { title: 'Notizen', price: 'Preis in Euro' },
      'de-CH': { price: 'Preis in Franken' },
    }

    expect(missingKeys(regional).filter((missing) => missing.locale !== 'de-CH')).toEqual([])
  })
})
