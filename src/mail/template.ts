/**
 * Simple HTML template engine with variable interpolation.
 *
 * Supports:
 *  - {{ variable }}
 *  - {{ nested.variable }}
 *  - {{{ unescaped }}} (triple braces = no HTML escaping)
 */

const ESCAPED_RE = /\{\{\s*([\w.]+)\s*\}\}/g
const UNESCAPED_RE = /\{\{\{\s*([\w.]+)\s*\}\}\}/g

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderTemplate(template: string, variables: Record<string, unknown> = {}): string {
  // Process unescaped first (triple braces) so they aren't caught by the double-brace pass
  let result = template.replace(UNESCAPED_RE, (_match, path: string) => {
    const value = getNestedValue(variables, path)
    return value === undefined || value === null ? '' : String(value)
  })

  result = result.replace(ESCAPED_RE, (_match, path: string) => {
    const value = getNestedValue(variables, path)
    return value === undefined || value === null ? '' : escapeHtml(String(value))
  })

  return result
}
