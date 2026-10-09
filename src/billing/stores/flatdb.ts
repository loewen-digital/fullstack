import { emptyAccount } from '../apply.js'
import { BillingError } from '../errors.js'
import type {
  BillingAccountRecord,
  BillingGrant,
  BillingHolding,
  BillingRefKind,
  BillingStore,
} from '../types.js'

/**
 * The slice of a flatdb `StorageAdapter` this store uses.
 *
 * Declared here so this file never imports `@loewen-digital/flatdb` (an optional peer
 * dependency); `FsAdapter`, `R2Adapter`, `MemoryAdapter` and `IndexedDBAdapter` of flatdb 0.3
 * satisfy it structurally. `readVersioned` and `writeIf` are optional in flatdb's own interface
 * and required here: they are what the store's guarantee rests on.
 */
export interface FlatdbBillingAdapter {
  read(path: string): Promise<string | null>
  readVersioned?(path: string): Promise<{ data: string | null; version: string | null }>
  writeIf?(path: string, data: string, version: string | null): Promise<string | null>
}

export interface FlatdbBillingStoreConfig {
  /** The adapter the app's `flatdb()` runs on */
  adapter: FlatdbBillingAdapter
  /**
   * The folder below the adapter's root (default: `billing`). It must not be the name of a
   * collection: the store writes its own files there, without a collection index.
   */
  prefix?: string
}

const ATTEMPTS = 20

/**
 * `BillingStore` on the storage adapter of `@loewen-digital/flatdb`: one JSON file per user
 * under `<prefix>/accounts/` and one per linked provider id under `<prefix>/refs/`.
 *
 * `transact` is a compare-and-swap on the account file (`readVersioned`, then `writeIf` with
 * the version read): a writer that lost the race reads again and re-applies its change, so two
 * events for one user that arrive in the same instant are both kept, and the same event
 * delivered twice at once is applied once. The guarantee is the adapter's: across every
 * Worker isolate with `R2Adapter`, within one process with `FsAdapter`.
 *
 * Usage:
 *   const adapter = new R2Adapter({ bucket: env.DATA })
 *   const store = createFlatdbBillingStore({ adapter })
 */
export function createFlatdbBillingStore(config: FlatdbBillingStoreConfig): BillingStore {
  const { adapter } = config
  const readVersioned = adapter.readVersioned?.bind(adapter)
  const writeIf = adapter.writeIf?.bind(adapter)
  if (!readVersioned || !writeIf) {
    throw new BillingError(
      'flatdb billing store: the adapter has no readVersioned/writeIf. Without conditional writes ' +
        'two events for one user can overwrite each other; use an adapter of @loewen-digital/flatdb 0.3 or later.',
    )
  }
  const prefix = (config.prefix ?? 'billing').replace(/^\/+|\/+$/g, '')
  const accountPath = (userId: string): string => `${prefix}/accounts/${fileName(userId)}.json`
  const refPath = (kind: BillingRefKind, id: string): string =>
    `${prefix}/refs/${kind}/${fileName(id)}.json`

  return {
    async getAccount(userId) {
      const data = await adapter.read(accountPath(userId))
      return data === null ? null : parseAccount(data, userId)
    },

    async transact(userId, change) {
      const path = accountPath(userId)
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const { data, version } = await readVersioned(path)
        const current = data === null ? emptyAccount(userId) : parseAccount(data, userId)
        const { account, result } = change(current)
        if (!account) return result
        if ((await writeIf(path, JSON.stringify(serializeAccount(account)), version)) !== null) {
          return result
        }
        // Another writer got there first: wait a moment so a burst spreads out, then read again.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)))
      }
      throw new BillingError(
        `flatdb billing store: the account of user ${JSON.stringify(userId)} could not be written, ` +
          `${ATTEMPTS} attempts lost against other writers.`,
      )
    },

    async link(kind, id, userId) {
      // Version `null` writes only when the file is absent, so the first link of an id stays.
      await writeIf(refPath(kind, id), JSON.stringify({ userId }), null)
    },

    async findUserId(kind, id) {
      const data = await adapter.read(refPath(kind, id))
      if (data === null) return null
      const ref: unknown = JSON.parse(data)
      return isRecord(ref) && typeof ref.userId === 'string' ? ref.userId : null
    },
  }
}

/**
 * An id as a file name: lower-case letters, digits, `_` and `-` stay, every other byte becomes
 * `~xx`. Upper-case letters are escaped too, so `Abc` and `abc` stay two files on a file system
 * that ignores case; `/` and `.` cannot leave the folder.
 */
function fileName(id: string): string {
  let name = ''
  for (const byte of new TextEncoder().encode(id)) {
    const char = String.fromCharCode(byte)
    name += /[a-z0-9_-]/.test(char) ? char : `~${byte.toString(16).padStart(2, '0')}`
  }
  if (name === '' || name.length > 200) {
    throw new BillingError(
      `flatdb billing store: ${JSON.stringify(id)} cannot be a file name (empty, or too long).`,
    )
  }
  return name
}

// Dates are stored as ISO 8601 strings (JSON has no `Date`) and returned as `Date`.
function serializeAccount(account: BillingAccountRecord): Record<string, unknown> {
  return {
    userId: account.userId,
    customerId: account.customerId,
    holdings: account.holdings.map((holding) => ({
      ...holding,
      startedAt: holding.startedAt.toISOString(),
      currentPeriodEnd: holding.currentPeriodEnd?.toISOString() ?? null,
      accessEndsAt: holding.accessEndsAt?.toISOString() ?? null,
      pastDueSince: holding.pastDueSince?.toISOString() ?? null,
      updatedAt: holding.updatedAt.toISOString(),
    })),
    grants: account.grants.map((grant) => ({
      product: grant.product,
      grantedAt: grant.grantedAt.toISOString(),
      until: grant.until?.toISOString() ?? null,
    })),
    appliedEvents: account.appliedEvents,
  }
}

function parseAccount(data: string, userId: string): BillingAccountRecord {
  const doc: unknown = JSON.parse(data)
  if (!isRecord(doc) || !Array.isArray(doc.holdings) || !Array.isArray(doc.appliedEvents)) {
    throw new BillingError(
      `flatdb billing store: the account file of user ${JSON.stringify(userId)} is not an account.`,
    )
  }
  return {
    userId,
    customerId: typeof doc.customerId === 'string' ? doc.customerId : null,
    holdings: doc.holdings.map((holding: unknown) => parseHolding(holding, userId)),
    // A file written before grants existed has none.
    grants: Array.isArray(doc.grants)
      ? doc.grants.map((grant: unknown) => parseGrant(grant, userId))
      : [],
    appliedEvents: doc.appliedEvents.map(String),
  }
}

function parseHolding(value: unknown, userId: string): BillingHolding {
  if (!isRecord(value)) {
    throw new BillingError(
      `flatdb billing store: a holding of user ${JSON.stringify(userId)} is not an object.`,
    )
  }
  return {
    id: String(value.id),
    product: String(value.product),
    type: value.type === 'subscription' ? 'subscription' : 'one-time',
    status:
      value.status === 'past_due' || value.status === 'canceled' || value.status === 'refunded'
        ? value.status
        : 'active',
    startedAt: toDate(value.startedAt, 'startedAt'),
    currentPeriodEnd:
      value.currentPeriodEnd == null ? null : toDate(value.currentPeriodEnd, 'currentPeriodEnd'),
    accessEndsAt: value.accessEndsAt == null ? null : toDate(value.accessEndsAt, 'accessEndsAt'),
    pastDueSince: value.pastDueSince == null ? null : toDate(value.pastDueSince, 'pastDueSince'),
    updatedAt: toDate(value.updatedAt, 'updatedAt'),
  }
}

function parseGrant(value: unknown, userId: string): BillingGrant {
  if (!isRecord(value) || typeof value.product !== 'string') {
    throw new BillingError(
      `flatdb billing store: a grant of user ${JSON.stringify(userId)} names no product.`,
    )
  }
  return {
    product: value.product,
    grantedAt: toDate(value.grantedAt, 'grantedAt'),
    until: value.until == null ? null : toDate(value.until, 'until'),
  }
}

function toDate(value: unknown, field: string): Date {
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  throw new BillingError(
    `flatdb billing store: "${field}" is not an ISO date string: ${JSON.stringify(value)}`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
