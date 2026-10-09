/** A misuse of the module: an unknown balance, an amount that is no whole number, a store without its guarantee */
export class UsageError extends Error {
  override name = 'UsageError'
}
