// i18n module — Task 2.4

import type { I18nConfig, I18nInstance, MessageKey, Messages } from './types.js'
import { textOf } from './catalog.js'
import { pluralize } from './pluralization.js'
import { formatNumber, formatDate } from './formatting.js'

export type { I18nConfig, I18nInstance, MessageKey, Messages, MissingKey } from './types.js'
export { missingKeys } from './missing.js'
export { negotiateLocale } from './negotiate.js'

/**
 * Translations for one active locale. With `messages` whose names are known when the code is
 * checked (an object in the source, an imported JSON file), `t` and `tn` take only keys that have
 * a text in one of the locales; with catalogs that were loaded at runtime they take any string.
 */
export function createI18n<M extends Messages = Messages>(
  config: I18nConfig<M> = {},
): I18nInstance<MessageKey<M[keyof M]>> {
  let activeLocale = config.locale ?? 'en'
  const fallback = config.fallback ?? 'en'
  const messages: Messages = { ...config.messages }

  function resolve(key: string): string {
    const text = textOf(messages[activeLocale], key) ?? textOf(messages[fallback], key)
    if (text !== undefined) return text
    config.onMissing?.(key, activeLocale)
    return key
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
