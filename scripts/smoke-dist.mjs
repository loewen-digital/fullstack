#!/usr/bin/env node
/**
 * Imports every subpath of the built package under Node ESM and opens the two sqlite entry points,
 * the way a consumer's `import` does. Runs at the end of `npm run build`: the test suite runs the
 * source through vitest, which hides what only the built files do (a bare `require`, a broken
 * exports map, an import that only resolves in the repo).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

let count = 0
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  if (subpath === './cli') continue // runs its main() on import
  await import(pathToFileURL(resolve(root, entry.import)).href)
  count++
}

const { createDb } = await import(pathToFileURL(resolve(root, 'dist/db/index.js')).href)
createDb({ driver: 'sqlite', url: ':memory:' }).close()

const { createSqliteFtsDriver } = await import(pathToFileURL(resolve(root, 'dist/search/index.js')).href)
await createSqliteFtsDriver(':memory:').flush('smoke')

console.log(`smoke: ${count} subpaths import under Node ESM, the sqlite db and search drivers load`)
