/**
 * Lazy-loads the correct driver module based on a config string.
 *
 * Usage:
 *   const driver = await resolveDriver(config.driver, {
 *     memory: () => import('./drivers/memory.js'),
 *     redis:  () => import('./drivers/redis.js'),
 *   })
 */
export async function resolveDriver<T>(
  name: string,
  map: Record<string, () => Promise<{ default: T } | T>>,
): Promise<T> {
  const loader = map[name]
  if (!loader) {
    const available = Object.keys(map).join(', ')
    throw new Error(`Unknown driver "${name}". Available drivers: ${available}`)
  }
  const mod = await loader()
  // Support both `export default` and `export { createXDriver as default }` shapes
  return (mod as { default: T }).default ?? (mod as T)
}
