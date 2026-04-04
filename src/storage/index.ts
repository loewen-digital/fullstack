import type { StorageConfig } from '../config/types.js'
import type { StorageDriver, StorageInstance } from './types.js'
import { StorageError } from '../errors/http-errors.js'
import { createMemoryDriver } from './drivers/memory.js'

export type { StorageConfig, StorageDriver, StorageInstance, FileMeta } from './types.js'
export { createMemoryDriver } from './drivers/memory.js'
export { createLocalDriver } from './drivers/local.js'
export { createS3Driver } from './drivers/s3.js'
export { createR2Driver } from './drivers/r2.js'

/**
 * Create a storage instance.
 *
 * Usage:
 *   const storage = createStorage({ driver: 'memory' })
 *   await storage.put('avatar.png', imageBytes)
 *   const data = await storage.get('avatar.png')
 */
export function createStorage(config: StorageConfig): StorageInstance {
  let driver: StorageDriver

  if (config.driver === 'memory') {
    driver = createMemoryDriver()
  } else if (config.driver === 'local') {
    throw new StorageError(
      'Local storage driver requires a root path. ' +
        'Import createLocalDriver from @loewen-digital/fullstack/storage and pass your options.',
    )
  } else if (config.driver === 's3') {
    throw new StorageError(
      'S3 storage driver requires credentials. ' +
        'Import createS3Driver from @loewen-digital/fullstack/storage and pass your options.',
    )
  } else if (config.driver === 'r2') {
    throw new StorageError(
      'R2 storage driver requires credentials. ' +
        'Import createR2Driver from @loewen-digital/fullstack/storage and pass your options.',
    )
  } else if (typeof config.driver === 'object') {
    driver = config.driver as StorageDriver
  } else {
    throw new StorageError(`Unknown storage driver: "${config.driver}"`)
  }

  return createStorageInstance(driver)
}

/**
 * Low-level factory: create a storage instance from any StorageDriver.
 */
export function createStorageInstance(driver: StorageDriver): StorageInstance {
  return {
    get: (key) => driver.get(key),

    async getText(key: string): Promise<string | null> {
      const data = await driver.get(key)
      if (data === null) return null
      return new TextDecoder().decode(data)
    },

    put: (key, data, meta) => driver.put(key, data, meta),
    delete: (key) => driver.delete(key),
    exists: (key) => driver.exists(key),
    list: (prefix) => driver.list(prefix),
    getUrl: (key) => driver.getUrl(key),
  }
}
