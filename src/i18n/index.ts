// i18n module — Task 2.4

import type { I18nConfig, I18nInstance } from './types.js'
import { pluralize } from './pluralization.js'
import { formatNumber, formatDate } from './formatting.js'

export type { I18nConfig, I18nInstance } from './types.js'

export function createI18n(config: I18nConfig = {}): I18nInstance {
  let activeLocale = config.locale ?? 'en'
  const fallback = config.fallback ?? 'en'
  const messages: Record<string, Record<string, unknown>> = { ...config.messages }

  /** Dot-notation key lookup in a flat or nested messages object */
  function lookup(locale: string, key: string): string | undefined {
    const catalog = messages[locale]
    if (!catalog) return undefined

    // Direct key
    if (typeof catalog[key] === 'string') return catalog[key] as string

    // Dot-notation traversal
    const parts = key.split('.')
    let current: unknown = catalog
    for (const part of parts) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : undefined
  }

  function resolve(key: string): string {
    return lookup(activeLocale, key)
      ?? lookup(fallback, key)
      ?? key
  }

  function interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) return template
    return template.replace(/:(\w+)/g, (_, name: string) => {
      return name in params ? String(params[name]) : `:${name}`
    })
  }

  return {
    t(key, params) {
      return interpolate(resolve(key), params)
    },

    tn(key, count, params) {
      const raw = resolve(key)
      const form = pluralize(raw, count)
      return interpolate(form, { count, ...params })
    },

    locale(name) {
      activeLocale = name
    },

    getLocale() {
      return activeLocale
    },

    number(value, options) {
      return formatNumber(activeLocale, value, options)
    },

    date(value, options) {
      return formatDate(activeLocale, value, options)
    },
  }
}

/**
 * Load translations from a directory of JSON files.
 * Each file is named after the locale (e.g. en.json, fr.json).
 * Node.js only.
 */
export async function loadTranslations(directory: string): Promise<Record<string, Record<string, unknown>>> {
  const { readdir, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')

  const files = await readdir(directory)
  const result: Record<string, Record<string, unknown>> = {}

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const locale = file.slice(0, -5)
    const content = await readFile(join(directory, file), 'utf8')
    result[locale] = JSON.parse(content) as Record<string, unknown>
  }

  return result
}
