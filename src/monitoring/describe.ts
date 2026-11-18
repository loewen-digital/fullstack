import { parseStack } from './stack.js'
import type { ErrorCause } from './types.js'

const MAX_MESSAGE = 1000
const MAX_CAUSES = 5
const MAX_KEYS = 10

/** A query string or fragment after an address, and a query string after a path */
const ADDRESS_QUERY = /\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'`<>)]+)[?#][^\s"'`<>)]*/gi
const PATH_QUERY = /(\/[\w\-./~%@+:]*)\?[^\s"'`<>)]*=[^\s"'`<>)]*/g

/**
 * A text as a report carries it: an address in it loses its query string, and the text ends
 * after 1000 characters. What an app writes into its own messages stays what it wrote.
 */
export function scrubText(text: string): string {
  return text.replace(ADDRESS_QUERY, '$1').replace(PATH_QUERY, '$1').slice(0, MAX_MESSAGE)
}

interface ErrorLike {
  name?: unknown
  message?: unknown
  stack?: unknown
  cause?: unknown
}

function isErrorLike(value: unknown): value is ErrorLike {
  if (typeof value !== 'object' || value === null) return false
  if (value instanceof Error) return true
  const like = value as ErrorLike
  return (
    typeof like.message === 'string' &&
    (typeof like.stack === 'string' || typeof like.name === 'string')
  )
}

/** Whether a value is an error, or something that was thrown in place of one */
export function isError(value: unknown): boolean {
  return isErrorLike(value)
}

function describeOne(value: unknown): ErrorCause {
  if (isErrorLike(value)) {
    const name = typeof value.name === 'string' && value.name !== '' ? value.name : 'Error'
    const message = typeof value.message === 'string' ? value.message : String(value.message)
    return { type: name, message: scrubText(message), frames: parseStack(value.stack) }
  }
  if (typeof value === 'string') return { type: 'Error', message: scrubText(value), frames: [] }
  if (typeof value === 'object' && value !== null) {
    // Its keys, never its values: an object thrown in place of an error can hold anything.
    const keys = Object.keys(value).slice(0, MAX_KEYS).join(', ')
    return { type: 'Error', message: scrubText(`Object thrown with keys: ${keys}`), frames: [] }
  }
  return {
    type: 'Error',
    message: scrubText(`${typeof value} thrown: ${String(value)}`),
    frames: [],
  }
}

/** What was thrown, as a report names it: type, message, frames and the chain of causes */
export function describe(error: unknown): ErrorCause & { causes: ErrorCause[] } {
  const causes: ErrorCause[] = []
  const seen = new Set<unknown>([error])
  let cause = isErrorLike(error) ? error.cause : undefined
  while (cause !== undefined && cause !== null && !seen.has(cause) && causes.length < MAX_CAUSES) {
    seen.add(cause)
    causes.push(describeOne(cause))
    cause = isErrorLike(cause) ? cause.cause : undefined
  }
  return { ...describeOne(error), causes }
}
