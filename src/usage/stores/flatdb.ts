import { emptyRecord } from '../apply.js'
import { UsageError } from '../errors.js'
import type { UsageBalanceRecord, UsagePeriodRecord, UsageRecord, UsageStore } from '../types.js'

/**
 * The slice of a flatdb `StorageAdapter` this store uses.
 *
 * Declared here so this file never imports `@loewen-digital/flatdb` (an optional peer
 * dependency); `FsAdapter`, `R2Adapter`, `MemoryAdapter` and `IndexedDBAdapter` of flatdb 0.3
 * satisfy it structurally. `readVersioned` and `writeIf` are optional in flatdb's own interface
 * and required here: they are what the store's guarantee rests on.
 */
export interface FlatdbUsageAdapter {
  read(path: string): Promise<string | null>
  readVersioned?(path: string): Promise<{ data: string | null; version: string | null }>
  writeIf?(path: string, data: string, version: string | null): Promise<string | null>
}

export interface FlatdbUsageStoreConfig {
  /** The adapter the app's `flatdb()` runs on */
  adapter: FlatdbUsageAdapter
  /**
   * The folder below the adapter's root (default: `usage`). It must not be the name of a
   * collection: the store writes its own files there, without a collection index.
   */
  prefix?: string
}

const ATTEMPTS = 20

/**
 * `UsageStore` on the storage adapter of `@loewen-digital/flatdb`: one JSON file per subject
 * under `<prefix>/`.
 *
 * `transact` is a compare-and-swap on that file (`readVersioned`, then `writeIf` with the
 * version read): a writer that lost the race reads again and decides again on the fresh record,
 * so calls that spend at the same time cannot together spend more than there is. The guarantee
 * is the adapter's: across every Worker isolate with `R2Adapter`, within one process with
 * `FsAdapter`.
 *
 * Usage:
 *   const adapter = new R2Adapter({ bucket: env.DATA })
 *   const store = createFlatdbUsageStore({ adapter })
 */
export function createFlatdbUsageStore(config: FlatdbUsageStoreConfig): UsageStore {
  const { adapter } = config
  const readVersioned = adapter.readVersioned?.bind(adapter)
  const writeIf = adapter.writeIf?.bind(adapter)
  if (!readVersioned || !writeIf) {
    throw new UsageError(
      'flatdb usage store: the adapter has no readVersioned/writeIf. Without conditional writes ' +
        'two calls can spend the same balance twice; use an adapter of @loewen-digital/flatdb 0.3 or later.',
    )
  }
  const prefix = (config.prefix ?? 'usage').replace(/^\/+|\/+$/g, '')
  const pathOf = (subject: string): string => `${prefix}/${fileName(subject)}.json`

  return {
    async read(subject) {
      const data = await adapter.read(pathOf(subject))
      return data === null ? null : parseRecord(data, subject)
    },

    async transact(subject, change) {
      const path = pathOf(subject)
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const { data, version } = await readVersioned(path)
        const current = data === null ? emptyRecord(subject) : parseRecord(data, subject)
        const { record, result } = change(current)
        if (!record) return result
        if ((await writeIf(path, JSON.stringify(record), version)) !== null) return result
        // Another writer got there first: wait a moment so a burst spreads out, then read again.
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)))
      }
      throw new UsageError(
        `flatdb usage store: the record of ${JSON.stringify(subject)} could not be written, ` +
          `${ATTEMPTS} attempts lost against other writers.`,
      )
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
    throw new UsageError(
      `flatdb usage store: ${JSON.stringify(id)} cannot be a file name (empty, or too long).`,
    )
  }
  return name
}

function parseRecord(data: string, subject: string): UsageRecord {
  const invalid = (): never => {
    throw new UsageError(
      `flatdb usage store: the file of ${JSON.stringify(subject)} is not a usage record.`,
    )
  }
  const doc: unknown = JSON.parse(data)
  if (!isRecord(doc) || !isRecord(doc.balances)) return invalid()

  // A balance that cannot be trusted must not be spent from: refuse the file, never guess.
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid()
  const text = (value: unknown): string => (typeof value === 'string' ? value : invalid())

  const balances: Record<string, UsageBalanceRecord> = {}
  for (const [name, value] of Object.entries(doc.balances)) {
    if (!isRecord(value) || !Array.isArray(value.credits) || !Array.isArray(value.periods)) {
      return invalid()
    }
    balances[name] = {
      balance: count(value.balance),
      credits: value.credits.map(text),
      periods: value.periods.map((period: unknown): UsagePeriodRecord => {
        if (!isRecord(period) || !isRecord(period.tags)) return invalid()
        return {
          start: text(period.start),
          end: text(period.end),
          spent: count(period.spent),
          tags: Object.fromEntries(
            Object.entries(period.tags).map(([tag, amount]) => [tag, count(amount)]),
          ),
        }
      }),
    }
  }
  return { subject, balances }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
