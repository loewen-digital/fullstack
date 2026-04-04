/**
 * Testing utilities for @loewen-digital/fullstack.
 *
 * Creates a pre-configured stack with in-memory/fake drivers —
 * no external services required.
 *
 * Usage:
 *   import { createTestStack } from '@loewen-digital/fullstack/testing'
 *
 *   const stack = createTestStack()
 *
 *   // Send mail and assert
 *   await stack.mail.send({ to: 'user@example.com', subject: 'Test', text: 'Hello' })
 *   expect(stack.fakeMail.sent).toHaveLength(1)
 *
 *   // Dispatch a job and assert
 *   await stack.queue.dispatch({ name: 'send-email', payload: {} })
 *   expect(stack.fakeQueue.dispatched).toHaveLength(1)
 */

import { createDb } from '../db/index.js'
import { createMailInstance } from '../mail/index.js'
import { createStorageInstance } from '../storage/index.js'
import { createQueueInstance } from '../queue/index.js'
import { createCacheInstance } from '../cache/index.js'
import { createSession } from '../session/index.js'
import { createMemoryDriver as createMemoryCacheDriver } from '../cache/drivers/memory.js'
import { createFakeMailDriver } from './fake-mail.js'
import { createFakeQueueDriver } from './fake-queue.js'
import { createFakeStorageDriver } from './fake-storage.js'

export { createFakeMailDriver } from './fake-mail.js'
export { createFakeQueueDriver } from './fake-queue.js'
export { createFakeStorageDriver } from './fake-storage.js'
export { withSavepoint, createDbCleaner, seedOnce } from './db-helpers.js'
export { defineFactory, sequence, pick } from './factories.js'
export type { FakeMailDriver } from './fake-mail.js'
export type { FakeQueueDriver } from './fake-queue.js'
export type { FakeStorageDriver } from './fake-storage.js'
export type { StandaloneFactory, FactoryFn } from './factories.js'

import type { DbConfig } from '../config/types.js'
import type { DbInstance } from '../db/index.js'
import type { MailInstance } from '../mail/index.js'
import type { StorageInstance } from '../storage/index.js'
import type { QueueInstance } from '../queue/index.js'
import type { CacheInstance } from '../cache/index.js'
import type { SessionManager } from '../session/index.js'
import type { FakeMailDriver } from './fake-mail.js'
import type { FakeQueueDriver } from './fake-queue.js'
import type { FakeStorageDriver } from './fake-storage.js'

export interface TestStackOptions {
  /** DB config. Defaults to in-memory SQLite. */
  db?: DbConfig
}

export interface TestStack {
  /** SQLite in-memory database */
  db: DbInstance
  /** Mail instance backed by fake driver */
  mail: MailInstance
  /** Storage instance backed by fake driver */
  storage: StorageInstance
  /** Queue instance backed by fake driver */
  queue: QueueInstance
  /** Cache instance backed by in-memory driver */
  cache: CacheInstance
  /** Session manager using memory driver */
  session: SessionManager

  // ── Fake drivers for test assertions ───────────────────────────────────
  /** Direct access to the fake mail driver for assertions */
  fakeMail: FakeMailDriver
  /** Direct access to the fake queue driver for assertions */
  fakeQueue: FakeQueueDriver
  /** Direct access to the fake storage driver for assertions */
  fakeStorage: FakeStorageDriver

  /** Reset all fakes (mail, queue, storage) to a clean state */
  reset(): void
}

/**
 * Create a test stack with all in-memory/fake drivers.
 *
 * No configuration required — works out of the box for unit and integration tests.
 *
 * @example
 * ```ts
 * const stack = createTestStack()
 *
 * // Use the db
 * await stack.db.migrate('./drizzle')
 *
 * // Assert mail was sent
 * await stack.mail.send({ to: 'user@example.com', subject: 'Hi', text: 'Hello' })
 * expect(stack.fakeMail.sent).toHaveLength(1)
 *
 * // Assert a job was dispatched
 * await stack.queue.dispatch({ name: 'process', payload: { id: 1 } })
 * expect(stack.fakeQueue.dispatched[0].name).toBe('process')
 *
 * // Reset between tests
 * afterEach(() => stack.reset())
 * ```
 */
export function createTestStack(options: TestStackOptions = {}): TestStack {
  const dbConfig: DbConfig = options.db ?? { driver: 'sqlite', url: ':memory:' }

  const db = createDb(dbConfig)

  const fakeMail = createFakeMailDriver()
  const mail = createMailInstance(fakeMail, { driver: 'console' })

  const fakeStorage = createFakeStorageDriver()
  const storage = createStorageInstance(fakeStorage)

  const fakeQueue = createFakeQueueDriver()
  const queue = createQueueInstance(fakeQueue)

  const cache = createCacheInstance(createMemoryCacheDriver())

  const session = createSession({ driver: 'memory' })

  return {
    db,
    mail,
    storage,
    queue,
    cache,
    session,
    fakeMail,
    fakeQueue,
    fakeStorage,

    reset() {
      fakeMail.clear()
      fakeQueue.clear()
      fakeStorage.clear()
    },
  }
}
