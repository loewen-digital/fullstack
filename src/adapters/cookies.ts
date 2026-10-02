/**
 * Cookie parsing and serializing for the adapters that work on raw headers (fetch, Remix, Nuxt).
 * Web Standards only; SvelteKit and Astro bring their own cookie API.
 */

export interface CookieAttributes {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  path?: string
  maxAge?: number
}

/** The cookies of a `Cookie` request header by name. */
export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const name = part.slice(0, eqIdx).trim()
    if (name) cookies[name] = decodeValue(part.slice(eqIdx + 1).trim())
  }
  return cookies
}

/** One `Set-Cookie` header value. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieAttributes = {},
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`
  if (options.path) cookie += `; Path=${options.path}`
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`
  if (options.httpOnly) cookie += '; HttpOnly'
  if (options.secure) cookie += '; Secure'
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`
  return cookie
}

// The header is the client's: a value that is not valid percent-encoding stays as it came
// instead of throwing out of every request that carries it.
function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
