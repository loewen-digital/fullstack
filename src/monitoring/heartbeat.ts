import { withTimeout } from './timeout.js'
import type { HeartbeatOptions } from './types.js'

/**
 * Tells a monitor that a job ran: one request to the address the monitor gave you, after the job
 * succeeded. The monitor raises the alarm when the ping stays away, so a job that fails or never
 * starts needs no code of its own.
 *
 * Usage (a scheduled handler of a Worker):
 *   async scheduled(controller, env, ctx) {
 *     await cleanUp(env)
 *     ctx.waitUntil(heartbeat(env.CLEANUP_HEARTBEAT_URL))
 *   }
 *
 * Answers whether the monitor took the ping. Never throws and gives up after `timeout`; without
 * an address it does nothing, so a job runs the same where no monitor is set up.
 */
export async function heartbeat(
  url: string | undefined,
  options: HeartbeatOptions = {},
): Promise<boolean> {
  if (!url) return false
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  try {
    const response = await withTimeout(options.timeout ?? 5000, 'the heartbeat', (signal) =>
      send(url, { method: options.method ?? 'POST', signal }),
    )
    void response.body?.cancel().catch(() => {})
    return response.ok
  } catch {
    return false
  }
}
