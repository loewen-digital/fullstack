/**
 * What the i18n module needs Node for. An entry of its own (`@loewen-digital/fullstack/i18n/node`):
 * `createI18n` runs in the browser as well, and a bundler that meets `node:fs` on the way to it
 * warns in every client build.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Reads every `<locale>.json` of a directory into the `messages` shape of `createI18n`: `en.json`
 * becomes the catalog of `en`. Other files are skipped.
 */
export async function loadTranslations(
  directory: string,
): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json')) continue
    const content = await readFile(join(directory, file), 'utf8')
    result[file.slice(0, -5)] = JSON.parse(content) as Record<string, unknown>
  }
  return result
}
