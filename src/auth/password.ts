import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const SALT_BYTES = 16
const KEY_LEN = 64
const SEPARATOR = ':'

/**
 * Hash a plaintext password using scrypt.
 * Format: `scrypt:<salt_hex>:<hash_hex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString('hex')
  const derivedKey = (await scryptAsync(password, salt, KEY_LEN)) as Buffer
  return `scrypt${SEPARATOR}${salt}${SEPARATOR}${derivedKey.toString('hex')}`
}

/**
 * Verify a plaintext password against a stored hash.
 * Returns true if the password matches.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(SEPARATOR)
    if (parts.length !== 3) return false
    const [algorithm, salt, hash] = parts
    if (algorithm !== 'scrypt' || !salt || !hash) return false

    const storedKey = Buffer.from(hash, 'hex')
    const derivedKey = (await scryptAsync(password, salt, KEY_LEN)) as Buffer

    if (storedKey.length !== derivedKey.length) return false
    return timingSafeEqual(storedKey, derivedKey)
  } catch {
    return false
  }
}
