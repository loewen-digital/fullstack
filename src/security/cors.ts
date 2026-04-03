import type { CorsConfig } from './types.js'

const DEFAULT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With']

/**
 * Compute CORS response headers for the given request origin.
 * Returns a `Headers` object that should be merged into the response.
 */
export function corsHeaders(origin: string | null, config: CorsConfig = {}): Headers {
  const headers = new Headers()

  const allowedOrigins = config.origins ?? ['*']
  const methods = config.methods ?? DEFAULT_METHODS
  const allowedHeaders = config.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS
  const exposedHeaders = config.exposedHeaders ?? []
  const credentials = config.credentials ?? false
  const maxAge = config.maxAge ?? 86400

  // Determine Allow-Origin
  if (allowedOrigins === '*') {
    headers.set('Access-Control-Allow-Origin', '*')
  } else if (origin && (allowedOrigins as string[]).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  } else {
    // Origin not allowed — return no CORS headers
    return headers
  }

  headers.set('Access-Control-Allow-Methods', methods.join(', '))
  headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '))

  if (exposedHeaders.length > 0) {
    headers.set('Access-Control-Expose-Headers', exposedHeaders.join(', '))
  }

  if (credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true')
  }

  headers.set('Access-Control-Max-Age', String(maxAge))

  return headers
}
