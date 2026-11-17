import { keysOf } from './catalog.js'
import type { Messages, MissingKey } from './types.js'

/**
 * The keys that some locale has a text for and another one lacks, a line per locale and key, in
 * the order of the catalogs. For a test of the catalogs: `expect(missingKeys(messages)).toEqual([])`.
 * A locale that leaves texts to the fallback on purpose is filtered out of the answer by its name.
 *
 * It compares which keys exist, not what the texts say: a text that is empty, or one that lacks a
 * `:name` the other locale fills, is not found here.
 */
export function missingKeys(messages: Messages): MissingKey[] {
  const everywhere = new Set<string>()
  const perLocale = Object.entries(messages).map(([locale, catalog]) => {
    const own = new Set(keysOf(catalog))
    for (const key of own) everywhere.add(key)
    return { locale, own }
  })

  const missing: MissingKey[] = []
  for (const { locale, own } of perLocale) {
    for (const key of everywhere) {
      if (!own.has(key)) missing.push({ locale, key })
    }
  }
  return missing
}
