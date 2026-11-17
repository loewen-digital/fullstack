#!/usr/bin/env node
/**
 * Imports every subpath of the built package under Node ESM and opens the two sqlite entry points,
 * the way a consumer's `import` does. Runs at the end of `npm run build`: the test suite runs the
 * source through vitest, which hides what only the built files do (a bare `require`, a broken
 * exports map, an import that only resolves in the repo).
 *
 * It also follows the imports of the entries a browser bundle takes and fails when one of them
 * reaches a Node module: a bundler warns about it in every client build, whether or not the code
 * that needs the module is ever called.
 */
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, relative, resolve } from 'node:path'

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

const { createSqliteFtsDriver } = await import(
  pathToFileURL(resolve(root, 'dist/search/index.js')).href
)
await createSqliteFtsDriver(':memory:').flush('smoke')

/** Subpaths that are imported into components as well as on the server */
const BROWSER_ENTRIES = ['./i18n']

/** Every Node module the file reaches through its own and its chunks' imports, static or dynamic */
function nodeModulesFrom(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)
  const found = []
  const specifiers = readFileSync(file, 'utf8').matchAll(
    /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
  )
  for (const [, specifier] of specifiers) {
    if (isBuiltin(specifier)) found.push(`${specifier} (${relative(root, file)})`)
    else if (specifier.startsWith('.')) {
      found.push(...nodeModulesFrom(resolve(dirname(file), specifier), seen))
    }
  }
  return found
}

for (const subpath of BROWSER_ENTRIES) {
  const found = nodeModulesFrom(resolve(root, pkg.exports[subpath].import))
  if (found.length > 0) {
    console.error(
      `smoke: ${subpath} is imported into browser bundles and reaches ${found.join(', ')}. Move what needs Node to an entry of its own.`,
    )
    process.exit(1)
  }
}

console.log(
  `smoke: ${count} subpaths import under Node ESM, the sqlite db and search drivers load, ${BROWSER_ENTRIES.join(', ')} reaches no Node module`,
)
