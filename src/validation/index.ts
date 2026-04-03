// Validation module — Task 2.1

import type {
  FieldRule,
  RuleObject,
  RulesMap,
  ValidationError,
  ValidationResult,
  InferValidated,
} from './types.js'
import { parseRuleString, BUILT_IN_RULES } from './rules.js'
import { getCustomRule } from './custom.js'

export type { FieldRule, RuleObject, RulesMap, ValidationError, ValidationResult, InferValidated, CustomRule } from './types.js'
export { defineRules } from './custom.js'

/**
 * Validate `data` against `rules`.
 *
 * Rules can be pipe-delimited strings ('required|string|max:255') or
 * rule objects ({ required: true, type: 'string', max: 255 }).
 *
 * Supports dot-notation for nested fields ('address.street')
 * and wildcard array items ('tags.*').
 */
export async function validate<Rules extends RulesMap>(
  data: Record<string, unknown>,
  rules: Rules
): Promise<ValidationResult<InferValidated<Rules>>> {
  const errors: ValidationError[] = []
  const output: Record<string, unknown> = {}

  for (const [fieldPath, fieldRule] of Object.entries(rules)) {
    // Handle wildcard array rules: 'tags.*'
    if (fieldPath.endsWith('.*')) {
      const arrayKey = fieldPath.slice(0, -2)
      const arrayValue = getNestedValue(data, arrayKey)
      if (Array.isArray(arrayValue)) {
        for (let i = 0; i < arrayValue.length; i++) {
          const itemPath = `${arrayKey}.${i}`
          const itemErrors = await validateField(itemPath, arrayValue[i], fieldRule, data)
          errors.push(...itemErrors)
        }
      }
      continue
    }

    const value = getNestedValue(data, fieldPath)
    const fieldErrors = await validateField(fieldPath, value, fieldRule, data)
    errors.push(...fieldErrors)

    if (fieldErrors.length === 0 && value !== undefined) {
      setNestedValue(output, fieldPath, value)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, data: output as InferValidated<Rules> }
}

async function validateField(
  field: string,
  value: unknown,
  rule: FieldRule,
  data: Record<string, unknown>
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []

  if (typeof rule === 'string') {
    const parsed = parseRuleString(rule)
    const isOptional = parsed.some((r) => r.name === 'optional')
    const isNullable = parsed.some((r) => r.name === 'nullable')

    if (isOptional && (value === undefined || value === null || value === '')) return []
    if (isNullable && value === null) return []

    for (const { name, param } of parsed) {
      const err = await runRule(name, value, param, field, data)
      if (err) errors.push({ field, rule: name, message: err })
    }
  } else {
    // Object rule format
    const obj = rule as RuleObject
    const isOptional = obj.optional === true
    const isNullable = obj.nullable === true

    if (isOptional && (value === undefined || value === null || value === '')) return []
    if (isNullable && value === null) return []

    // required
    if (obj.required !== false) {
      const requiredFn = BUILT_IN_RULES['required']
      const err = requiredFn ? requiredFn(value, undefined, field, data) : null
      if (err) { errors.push({ field, rule: 'required', message: err }); return errors }
    }

    if (obj.type) {
      const err = BUILT_IN_RULES[obj.type]?.(value, undefined, field, data)
      if (err) errors.push({ field, rule: 'type', message: err })
    }

    for (const key of ['min', 'max', 'email', 'url', 'uuid', 'date', 'confirmed'] as const) {
      if (obj[key] !== undefined && obj[key] !== false) {
        const param = typeof obj[key] === 'number' ? String(obj[key]) : undefined
        const err = BUILT_IN_RULES[key]?.(value, param, field, data)
        if (err) errors.push({ field, rule: key, message: err })
      }
    }

    if (obj.in !== undefined) {
      const param = (obj.in as unknown[]).map(String).join(',')
      const inFn = BUILT_IN_RULES['in']
      const err = inFn ? inFn(value, param, field, data) : null
      if (err) errors.push({ field, rule: 'in', message: err })
    }

    if (obj.regex !== undefined) {
      const param = obj.regex instanceof RegExp ? obj.regex.source : String(obj.regex)
      const regexFn = BUILT_IN_RULES['regex']
      const err = regexFn ? regexFn(value, param, field, data) : null
      if (err) errors.push({ field, rule: 'regex', message: err })
    }

    if (obj.before !== undefined) {
      const param = obj.before instanceof Date ? obj.before.toISOString() : String(obj.before)
      const beforeFn = BUILT_IN_RULES['before']
      const err = beforeFn ? beforeFn(value, param, field, data) : null
      if (err) errors.push({ field, rule: 'before', message: err })
    }

    if (obj.after !== undefined) {
      const param = obj.after instanceof Date ? obj.after.toISOString() : String(obj.after)
      const afterFn = BUILT_IN_RULES['after']
      const err = afterFn ? afterFn(value, param, field, data) : null
      if (err) errors.push({ field, rule: 'after', message: err })
    }
  }

  return errors
}

async function runRule(
  name: string,
  value: unknown,
  param: string | undefined,
  field: string,
  data: Record<string, unknown>
): Promise<string | null> {
  const builtin = BUILT_IN_RULES[name]
  if (builtin) return builtin(value, param, field, data)

  const custom = getCustomRule(name)
  if (custom) {
    const valid = await custom.validate(value, param, data)
    return valid ? null : custom.message(field, param)
  }

  return null
}

function getNestedValue(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = data
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part) continue
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  const lastPart = parts[parts.length - 1]
  if (lastPart) current[lastPart] = value
}
