/**
 * How a key finds its text in a catalog, and which keys a catalog has. The two have to agree, and
 * so does `MessageKey` in `types.ts`, which says the same to the type checker.
 */

/**
 * The text of `key` in a catalog: a name at its top (one with dots in it as well), or names joined
 * by dots that lead through nested objects to a text.
 */
export function textOf(catalog: unknown, key: string): string | undefined {
  if (catalog === null || typeof catalog !== 'object') return undefined
  const direct = (catalog as Record<string, unknown>)[key]
  if (typeof direct === 'string') return direct

  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

/** Every key `textOf` finds a text for, in the order of the catalog */
export function keysOf(catalog: unknown): string[] {
  const keys: string[] = []
  const walk = (value: unknown, prefix: string | null): void => {
    if (value === null || typeof value !== 'object') return
    for (const [name, child] of Object.entries(value)) {
      // Below the top a dot always separates two names, so a name with one in it is never reached.
      const reachable = !name.includes('.')
      if (typeof child === 'string') {
        if (prefix === null) keys.push(name)
        else if (reachable) keys.push(`${prefix}.${name}`)
      } else if (reachable) {
        walk(child, prefix === null ? name : `${prefix}.${name}`)
      }
    }
  }
  walk(catalog, null)
  return keys
}
