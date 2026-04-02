import type { SerializedError } from './types.js'
import { FullstackError } from './http-errors.js'

/**
 * Formats any error into a JSON-serializable shape suitable for API responses.
 */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof FullstackError) {
    return {
      error: err.code,
      message: err.message,
      statusCode: err.statusCode,
      ...(Object.keys(err.context).length > 0 ? { context: err.context } : {}),
    }
  }

  if (err instanceof Error) {
    return {
      error: 'INTERNAL_ERROR',
      message: err.message,
      statusCode: 500,
    }
  }

  return {
    error: 'UNKNOWN_ERROR',
    message: String(err),
    statusCode: 500,
  }
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => { out[k] = v })
    return out
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers as [string, string][])
  }
  return headers as Record<string, string>
}

/**
 * Converts a FullstackError (or any error) to a Web-standard Response.
 */
export function errorToResponse(err: unknown, headers?: HeadersInit): Response {
  const serialized = serializeError(err)
  return new Response(JSON.stringify(serialized), {
    status: serialized.statusCode,
    headers: new Headers({ 'Content-Type': 'application/json', ...headersToRecord(headers) }),
  })
}

/**
 * Returns true if the given value is a FullstackError with the given code.
 */
export function isFullstackError(err: unknown, code?: string): err is FullstackError {
  if (!(err instanceof FullstackError)) return false
  if (code !== undefined) return err.code === code
  return true
}
