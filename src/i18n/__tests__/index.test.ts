import { describe, it, expect } from 'vitest'
import { createI18n } from '../index.js'
import { pluralize } from '../pluralization.js'
import { formatNumber, formatDate } from '../formatting.js'

const messages = {
  en: {
    greeting: 'Hello, :name!',
    farewell: 'Goodbye',
    auth: {
      errors: {
        invalid_password: 'Invalid password',
      },
    },
    apples: 'one apple|:count apples',
    items: 'no items|one item|:count items',
  },
  fr: {
    greeting: 'Bonjour, :name !',
    farewell: 'Au revoir',
  },
}

describe('createI18n — t()', () => {
  it('translates a simple key', () => {
    const i18n = createI18n({ messages })
    expect(i18n.t('farewell')).toBe('Goodbye')
  })

  it('interpolates params', () => {
    const i18n = createI18n({ messages })
    expect(i18n.t('greeting', { name: 'Alice' })).toBe('Hello, Alice!')
  })

  it('returns key when translation is missing', () => {
    const i18n = createI18n({ messages })
    expect(i18n.t('missing.key')).toBe('missing.key')
  })

  it('supports nested dot-notation keys', () => {
    const i18n = createI18n({ messages })
    expect(i18n.t('auth.errors.invalid_password')).toBe('Invalid password')
  })

  it('falls back to fallback locale', () => {
    const i18n = createI18n({ messages, locale: 'fr', fallback: 'en' })
    // farewell exists in fr
    expect(i18n.t('farewell')).toBe('Au revoir')
    // auth.errors.invalid_password only in en → fallback
    expect(i18n.t('auth.errors.invalid_password')).toBe('Invalid password')
  })
})

describe('createI18n — locale()', () => {
  it('switches locale', () => {
    const i18n = createI18n({ messages, locale: 'en' })
    expect(i18n.t('farewell')).toBe('Goodbye')
    i18n.locale('fr')
    expect(i18n.t('farewell')).toBe('Au revoir')
    expect(i18n.getLocale()).toBe('fr')
  })
})

describe('createI18n — tn() pluralization', () => {
  it('selects singular form (count=1)', () => {
    const i18n = createI18n({ messages })
    expect(i18n.tn('apples', 1)).toBe('one apple')
  })

  it('selects plural form (count=5)', () => {
    const i18n = createI18n({ messages })
    expect(i18n.tn('apples', 5)).toBe('5 apples')
  })

  it('three-form plural: zero', () => {
    const i18n = createI18n({ messages })
    expect(i18n.tn('items', 0)).toBe('no items')
  })

  it('three-form plural: one', () => {
    const i18n = createI18n({ messages })
    expect(i18n.tn('items', 1)).toBe('one item')
  })

  it('three-form plural: many', () => {
    const i18n = createI18n({ messages })
    expect(i18n.tn('items', 7)).toBe('7 items')
  })
})

describe('createI18n — number() and date()', () => {
  it('formats a number', () => {
    const i18n = createI18n({ locale: 'en' })
    const result = i18n.number(1234567.89)
    expect(result).toContain('1,234,567')
  })

  it('formats a date', () => {
    const i18n = createI18n({ locale: 'en' })
    const result = i18n.date(new Date('2024-06-15'), { year: 'numeric', month: 'long', day: 'numeric' })
    expect(result).toContain('2024')
    expect(result).toContain('June')
  })

  it('formats a date from timestamp', () => {
    const i18n = createI18n({ locale: 'en' })
    const ts = new Date('2024-01-01').getTime()
    const result = i18n.date(ts, { year: 'numeric' })
    expect(result).toContain('2024')
  })
})

describe('pluralize()', () => {
  it('single form — returns as-is', () => {
    expect(pluralize('apple', 1)).toBe('apple')
    expect(pluralize('apple', 5)).toBe('apple')
  })

  it('two forms — count=1 → first', () => {
    expect(pluralize('apple|apples', 1)).toBe('apple')
  })

  it('two forms — count=0 → second', () => {
    expect(pluralize('apple|apples', 0)).toBe('apples')
  })

  it('two forms — count=3 → second', () => {
    expect(pluralize('apple|apples', 3)).toBe('apples')
  })

  it('substitutes :count', () => {
    expect(pluralize(':count item|:count items', 5)).toBe('5 items')
  })
})

describe('formatNumber()', () => {
  it('formats with en locale', () => {
    expect(formatNumber('en', 1000)).toBe('1,000')
  })
})

describe('formatDate()', () => {
  it('formats a Date object', () => {
    const result = formatDate('en', new Date('2024-03-15'), { year: 'numeric', month: 'short' })
    expect(result).toContain('Mar')
    expect(result).toContain('2024')
  })

  it('formats a date string', () => {
    const result = formatDate('en', '2024-12-25', { year: 'numeric' })
    expect(result).toContain('2024')
  })
})
