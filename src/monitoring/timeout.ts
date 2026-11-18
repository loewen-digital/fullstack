import { MonitoringError } from './errors.js'

/**
 * Runs `task` with a signal that aborts after `ms`, and rejects at that moment whether or not the
 * task listens to the signal: nothing here may wait longer than it was told to.
 */
export async function withTimeout<T>(
  ms: number,
  what: string,
  task: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason as Error), {
      once: true,
    })
  })
  const timer = setTimeout(
    () => controller.abort(new MonitoringError(`monitoring: ${what} took longer than ${ms} ms`)),
    ms,
  )
  try {
    const running = Promise.resolve().then(() => task(controller.signal))
    // The task loses the race when the time is up; what it rejects with later is nobody's.
    running.catch(() => {})
    return await Promise.race([running, expired])
  } finally {
    clearTimeout(timer)
  }
}
