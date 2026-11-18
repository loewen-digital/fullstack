import { MonitoringError } from './errors.js'
import { withTimeout } from './timeout.js'
import type { HealthHandler, HealthHandlerConfig } from './types.js'

const HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  // An answer from a cache would say "up" for an app that is down.
  'Cache-Control': 'no-store',
}

/**
 * Create the handler an uptime monitor asks: 200 when every check passes, 503 when one fails.
 * A monitor sends no credentials, so the endpoint is open to anyone, and the answer is the same
 * two words for everyone: which check failed and why goes to `onFailure`, never into the response.
 *
 * Usage (a SvelteKit `+server.ts`; a Worker or a Pages Function passes its `request`):
 *   const health = createHealthHandler({
 *     checks: {
 *       storage: () => bucket.head('health'),
 *       sessions: (signal) => fetch(sessionsUrl, { signal }).then((response) => response.ok),
 *     },
 *   })
 *   export const GET = ({ request }) => health(request)
 *
 * A check passes unless it throws, rejects, answers `false` or takes longer than `timeout`. The
 * checks run on every request: keep each to one cheap read.
 */
export function createHealthHandler(config: HealthHandlerConfig = {}): HealthHandler {
  const checks = Object.entries(config.checks ?? {})
  const timeout = config.timeout ?? 3000
  const onFailure =
    config.onFailure ??
    ((name: string, error: unknown) => console.error(`health: check "${name}" failed`, error))

  async function passes(name: string, check: (signal: AbortSignal) => unknown): Promise<boolean> {
    try {
      const result = await withTimeout(timeout, `the health check "${name}"`, check)
      if (result !== false) return true
      throw new MonitoringError(`monitoring: the health check "${name}" answered false`)
    } catch (error) {
      try {
        onFailure(name, error)
      } catch {
        // The answer to the monitor does not depend on the function that is told about a failure.
      }
      return false
    }
  }

  return async function handleHealth(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', {
        status: 405,
        headers: { ...HEADERS, Allow: 'GET, HEAD' },
      })
    }
    const results = await Promise.all(checks.map(([name, check]) => passes(name, check)))
    const up = results.every(Boolean)
    return new Response(request.method === 'HEAD' ? null : up ? 'ok' : 'unavailable', {
      status: up ? 200 : 503,
      headers: HEADERS,
    })
  }
}
