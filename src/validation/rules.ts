// Built-in validation rules — Task 2.1

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ParsedRule {
  name: string
  param?: string
}

// Cache parsed rule strings — rule strings are almost always static literals, so
// memoizing eliminates repeated string splitting on every validate() call.
const ruleStringCache = new Map<string, ParsedRule[]>()

/**
 * Parse a pipe-delimited rule string into individual rule objects.
 * e.g. 'required|string|max:255' → [{name:'required'},{name:'string'},{name:'max',param:'255'}]
 *
 * Results are memoized — rule strings used as static literals pay the parse cost once.
 */
export function parseRuleString(rule: string): ParsedRule[] {
  const cached = ruleStringCache.get(rule)
  if (cached) return cached

  const parsed = rule.split('|').map((segment) => {
    const colonIdx = segment.indexOf(':')
    if (colonIdx === -1) return { name: segment.trim() }
    return { name: segment.slice(0, colonIdx).trim(), param: segment.slice(colonIdx + 1).trim() }
  })
  ruleStringCache.set(rule, parsed)
  return parsed
}

// Cache compiled RegExp instances — avoids re-compiling the same pattern on every call.
const regexCache = new Map<string, RegExp>()

export type RuleValidator = (
  value: unknown,
  param: string | undefined,
  field: string,
  data: Record<string, unknown>
) => string | null

/** Returns an error message string on failure, null on success */
export const BUILT_IN_RULES: Record<string, RuleValidator> = {
  required(value, _, field) {
    if (value === undefined || value === null || value === '') {
      return `The ${field} field is required.`
    }
    return null
  },

  optional() {
    return null
  },

  nullable() {
    return null
  },

  string(value, _, field) {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      return `The ${field} field must be a string.`
    }
    return null
  },

  number(value, _, field) {
    if (value !== null && value !== undefined && typeof value !== 'number') {
      return `The ${field} field must be a number.`
    }
    return null
  },

  boolean(value, _, field) {
    if (value !== null && value !== undefined && typeof value !== 'boolean') {
      return `The ${field} field must be a boolean.`
    }
    return null
  },

  array(value, _, field) {
    if (value !== null && value !== undefined && !Array.isArray(value)) {
      return `The ${field} field must be an array.`
    }
    return null
  },

  object(value, _, field) {
    if (value !== null && value !== undefined && (typeof value !== 'object' || Array.isArray(value))) {
      return `The ${field} field must be an object.`
    }
    return null
  },

  min(value, param, field) {
    const min = Number(param)
    if (typeof value === 'string' && value.length < min) {
      return `The ${field} field must be at least ${min} characters.`
    }
    if (typeof value === 'number' && value < min) {
      return `The ${field} field must be at least ${min}.`
    }
    if (Array.isArray(value) && value.length < min) {
      return `The ${field} field must have at least ${min} items.`
    }
    return null
  },

  max(value, param, field) {
    const max = Number(param)
    if (typeof value === 'string' && value.length > max) {
      return `The ${field} field must not exceed ${max} characters.`
    }
    if (typeof value === 'number' && value > max) {
      return `The ${field} field must not exceed ${max}.`
    }
    if (Array.isArray(value) && value.length > max) {
      return `The ${field} field must not have more than ${max} items.`
    }
    return null
  },

  email(value, _, field) {
    if (value !== null && value !== undefined && !EMAIL_RE.test(String(value))) {
      return `The ${field} field must be a valid email address.`
    }
    return null
  },

  url(value, _, field) {
    if (value !== null && value !== undefined && !URL_RE.test(String(value))) {
      return `The ${field} field must be a valid URL.`
    }
    return null
  },

  uuid(value, _, field) {
    if (value !== null && value !== undefined && !UUID_RE.test(String(value))) {
      return `The ${field} field must be a valid UUID.`
    }
    return null
  },

  date(value, _, field) {
    if (value !== null && value !== undefined) {
      const d = new Date(value as string)
      if (isNaN(d.getTime())) {
        return `The ${field} field must be a valid date.`
      }
    }
    return null
  },

  before(value, param, field) {
    if (value !== null && value !== undefined && param) {
      const val = new Date(value as string)
      const limit = new Date(param)
      if (isNaN(val.getTime()) || val >= limit) {
        return `The ${field} field must be a date before ${param}.`
      }
    }
    return null
  },

  after(value, param, field) {
    if (value !== null && value !== undefined && param) {
      const val = new Date(value as string)
      const limit = new Date(param)
      if (isNaN(val.getTime()) || val <= limit) {
        return `The ${field} field must be a date after ${param}.`
      }
    }
    return null
  },

  in(value, param, field) {
    if (value !== null && value !== undefined && param) {
      const options = param.split(',').map((s) => s.trim())
      if (!options.includes(String(value))) {
        return `The ${field} field must be one of: ${options.join(', ')}.`
      }
    }
    return null
  },

  regex(value, param, field) {
    if (value !== null && value !== undefined && param) {
      let re = regexCache.get(param)
      if (!re) {
        re = new RegExp(param)
        regexCache.set(param, re)
      }
      if (!re.test(String(value))) {
        return `The ${field} field format is invalid.`
      }
    }
    return null
  },

  confirmed(value, _, field, data) {
    const confirmation = data[`${field}_confirmation`]
    if (value !== confirmation) {
      return `The ${field} confirmation does not match.`
    }
    return null
  },
}
