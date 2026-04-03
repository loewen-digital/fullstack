// Custom rule registration — Task 2.1

import type { CustomRule } from './types.js'

const customRules = new Map<string, CustomRule>()

export function defineRules(rules: CustomRule[]): void {
  for (const rule of rules) {
    customRules.set(rule.name, rule)
  }
}

export function getCustomRule(name: string): CustomRule | undefined {
  return customRules.get(name)
}

export function clearCustomRules(): void {
  customRules.clear()
}
