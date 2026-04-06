#!/usr/bin/env node
/**
 * Bundle size audit — Task 9.3
 *
 * Reports the gzip and raw size of every subpath export in dist/.
 * Run after `npm run build`:  node scripts/bundle-size.mjs
 */

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(__dirname, '..')
const distDir = resolve(root, 'dist')

// Read package.json exports to get the canonical list of entry files
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

const COLS = {
  subpath: 28,
  file: 40,
  raw: 10,
  gzip: 10,
}

function pad(str, len) {
  return String(str).padEnd(len)
}

function rpad(str, len) {
  return String(str).padStart(len)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function measureFile(absPath) {
  try {
    const content = readFileSync(absPath)
    const raw = content.length
    const gzip = gzipSync(content).length
    return { raw, gzip }
  } catch {
    return null
  }
}

console.log('\n@loewen-digital/fullstack — Bundle Size Report\n')
console.log(
  pad('Subpath', COLS.subpath) +
  pad('File', COLS.file) +
  rpad('Raw', COLS.raw) +
  rpad('Gzip', COLS.gzip)
)
console.log('─'.repeat(COLS.subpath + COLS.file + COLS.raw + COLS.gzip))

let totalRaw = 0
let totalGzip = 0
const entries = []

for (const [subpath, entry] of Object.entries(pkg.exports)) {
  const importPath = entry.import
  if (!importPath) continue

  // importPath is like "./dist/validation/index.js"
  const absPath = resolve(root, importPath.replace(/^\.\//, ''))
  const relPath = relative(root, absPath)
  const sizes = measureFile(absPath)

  if (!sizes) {
    entries.push({ subpath, relPath, raw: null, gzip: null })
    continue
  }

  totalRaw += sizes.raw
  totalGzip += sizes.gzip
  entries.push({ subpath, relPath, ...sizes })
}

// Sort by raw size descending
entries.sort((a, b) => (b.raw ?? 0) - (a.raw ?? 0))

for (const { subpath, relPath, raw, gzip } of entries) {
  if (raw === null) {
    console.log(
      pad(subpath, COLS.subpath) +
      pad(relPath, COLS.file) +
      rpad('(not built)', COLS.raw + COLS.gzip)
    )
  } else {
    console.log(
      pad(subpath, COLS.subpath) +
      pad(relPath, COLS.file) +
      rpad(formatBytes(raw), COLS.raw) +
      rpad(formatBytes(gzip), COLS.gzip)
    )
  }
}

console.log('─'.repeat(COLS.subpath + COLS.file + COLS.raw + COLS.gzip))
console.log(
  pad('TOTAL', COLS.subpath + COLS.file) +
  rpad(formatBytes(totalRaw), COLS.raw) +
  rpad(formatBytes(totalGzip), COLS.gzip)
)
console.log()

// Tree-shaking check: warn about any unexpected re-exports in the root index
const rootIndexPath = resolve(distDir, 'index.js')
try {
  const rootContent = readFileSync(rootIndexPath, 'utf8')
  const reExportCount = (rootContent.match(/^export/gm) ?? []).length
  console.log(`Root index re-exports: ${reExportCount} named exports`)
  if (reExportCount > 50) {
    console.warn('  ⚠  Large root index — consumers should use subpath imports for optimal tree-shaking.')
  } else {
    console.log('  ✓  Root index size looks healthy.')
  }
} catch {
  console.log('Root index: (not built yet — run npm run build first)')
}

console.log()
