import { emptyRecord } from '../apply.js'
import type { UsageRecord, UsageStore } from '../types.js'

/**
 * `UsageStore` in the memory of this process: for development and tests. Nothing survives a
 * restart, and on Cloudflare Workers every isolate has its own.
 *
 * `transact` reads, changes and writes without yielding in between, so concurrent calls cannot
 * interleave.
 */
export function createMemoryUsageStore(): UsageStore {
  const records = new Map<string, UsageRecord>()

  return {
    async read(subject) {
      const record = records.get(subject)
      return record ? structuredClone(record) : null
    },

    async transact(subject, change) {
      const current = records.get(subject)
      const { record, result } = change(current ? structuredClone(current) : emptyRecord(subject))
      if (record) records.set(subject, structuredClone(record))
      return result
    },
  }
}
