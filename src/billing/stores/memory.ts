import { emptyAccount } from '../apply.js'
import type { BillingAccountRecord, BillingRefKind, BillingStore } from '../types.js'

/**
 * `BillingStore` in the memory of this process: for development and tests. Nothing survives a
 * restart, and on Cloudflare Workers every isolate has its own.
 *
 * `transact` reads, changes and writes without yielding in between, so concurrent calls cannot
 * interleave.
 */
export function createMemoryBillingStore(): BillingStore {
  const accounts = new Map<string, BillingAccountRecord>()
  const refs = new Map<string, string>()

  return {
    async getAccount(userId) {
      const account = accounts.get(userId)
      return account ? structuredClone(account) : null
    },

    async transact(userId, change) {
      const current = accounts.get(userId)
      const { account, result } = change(current ? structuredClone(current) : emptyAccount(userId))
      if (account) accounts.set(userId, structuredClone(account))
      return result
    },

    async link(kind: BillingRefKind, id, userId) {
      const key = `${kind}:${id}`
      if (!refs.has(key)) refs.set(key, userId)
    },

    async findUserId(kind: BillingRefKind, id) {
      return refs.get(`${kind}:${id}`) ?? null
    },
  }
}
