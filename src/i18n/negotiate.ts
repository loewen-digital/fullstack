/**
 * Which of an app's locales a request asks for: its `Accept-Language` header against the list of
 * locales the app speaks. Plain string work, so it runs on Workers, in Node and in the browser.
 */

/**
 * One entry of the header as RFC 9110 writes it, lower-cased: a language (`de`, `de-ch`,
 * `zh-hant-tw`) and an optional weight (`;q=0.8`). Anything else is no entry, and neither is `*`,
 * the range for "any language": it names none of them.
 */
const ENTRY = /^([a-z]{1,8}(?:-[a-z0-9]{1,8})*)\s*(?:;\s*q=(0(?:\.\d*)?|1(?:\.0*)?))?$/
/**
 * The longest tag that is read: the length RFC 5646 asks every limit to leave room for (4.4.1).
 * The header is whatever a client sends, and a tag of thousands of parts would be shortened
 * thousands of times.
 */
const LONGEST_TAG = 35

/**
 * The tag without its last part, and without a single letter that would then end it (the `x` of
 * `de-x-private` opens a part of its own): `zh-hant-tw` → `zh-hant` → `zh` → ``.
 */
function shortened(tag: string): string {
  let end = tag.lastIndexOf('-')
  while (end === 1 || (end > 1 && tag[end - 2] === '-')) end -= 2
  return end > 0 ? tag.slice(0, end) : ''
}

/**
 * Where in `known` the locale is that comes closest to what a range asks for, or -1. The range as
 * it is comes first, then a locale that says more than it (`de` asks, the app speaks `de-de`), and
 * the same again for the range with one part less at a time.
 */
function closest(range: string, known: readonly string[]): number {
  for (let tag = range; tag !== ''; tag = shortened(tag)) {
    const same = known.indexOf(tag)
    if (same !== -1) return same
    const variant = known.findIndex((locale) => locale.startsWith(`${tag}-`))
    if (variant !== -1) return variant
  }
  return -1
}

/**
 * The locale of `supported` that a request wants most, or `undefined` when it asks for none of
 * them. Takes the `Accept-Language` header or the `Request` that carries it.
 *
 * - A language with a higher weight (`q`) comes first; among equal weights the order of the header
 *   decides. `q=0` says "not this one" and is left out, and so is `*`, which names no language.
 * - A region the app does not speak counts as its language: `de-CH` gets `de`. The other way
 *   round too: `de` gets `de-DE`, and so does `de-CH`, when that is the German the app has. Of
 *   several such locales the one that is earlier in `supported` wins.
 * - Upper and lower case do not matter. The answer is written the way `supported` writes it.
 * - An entry that is no language with an optional weight is skipped, and so is a tag of more than
 *   35 characters. What stands next to it still counts.
 *
 * Which source wins (an account, a cookie, the address, this header) is the app's decision, and so
 * is the locale of a request that asks for none: `negotiateLocale(request, locales) ?? 'en'`.
 */
export function negotiateLocale<const L extends string>(
  source: string | Request | null | undefined,
  supported: readonly L[],
): L | undefined {
  const header = typeof source === 'string' ? source : source?.headers.get('accept-language')
  if (!header) return undefined

  const ranges: { tag: string; weight: number }[] = []
  for (const part of header.split(',')) {
    const entry = ENTRY.exec(part.trim().toLowerCase())
    if (!entry) continue
    const tag = entry[1]!
    const weight = entry[2] === undefined ? 1 : Number(entry[2])
    if (tag.length <= LONGEST_TAG && weight > 0) ranges.push({ tag, weight })
  }
  // The sort keeps the order of the header among equal weights.
  ranges.sort((a, b) => b.weight - a.weight)

  const known = supported.map((locale) => locale.toLowerCase())
  for (const { tag } of ranges) {
    const index = closest(tag, known)
    if (index !== -1) return supported[index]
  }
  return undefined
}
