/**
 * Every ```ts block on the documented pages compiles against the package source, the way a
 * SvelteKit 2 project with `strict: true` would compile it.
 *
 * Rules for a page:
 * - A block whose first line is `// <path>.ts` is written to that path. Files under `src/routes/`
 *   get a `./$types` stub next to them, `$lib/*` points at the page's `src/lib/`, and
 *   `$env/dynamic/private` is stubbed.
 * - Every other block is appended, in order, to one module per page, so a later block may use
 *   what an earlier one declared. Names an earlier block already imported are dropped from
 *   later named imports.
 */
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// Inside node_modules, so that bare imports (@sveltejs/kit, @types/node) resolve from the samples.
const OUT = join(ROOT, 'node_modules/.cache/docs-samples')

const PAGES = ['modules/auth', 'modules/session', 'adapters/sveltekit']

const ENV_STUB = `declare module '$env/dynamic/private' {
  export const env: Record<string, string | undefined>
}
`
const TYPES_STUB = `import type { Actions as KitActions, RequestHandler as KitRequestHandler, ServerLoad } from '@sveltejs/kit'
export type PageServerLoad = ServerLoad
export type Actions = KitActions
export type RequestHandler = KitRequestHandler
`

interface Block {
  file: string | null
  code: string
}

function extractBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```ts') continue
    const start = i + 1
    let end = start
    while (end < lines.length && lines[end] !== '```') end++
    const code = lines.slice(start, end)
    const header = /^\/\/ ([\w./+-]+\.ts)$/.exec(code[0] ?? '')
    blocks.push({ file: header?.[1] ?? null, code: code.join('\n') })
    i = end
  }
  return blocks
}

function writeSamples(name: string, blocks: Block[]): { dir: string; files: string[] } {
  const dir = join(OUT, name)
  rmSync(dir, { recursive: true, force: true })
  const files = new Set<string>()
  const write = (relative: string, content: string): void => {
    const path = join(dir, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    files.add(path)
  }

  write('env.d.ts', ENV_STUB)

  const fragments: string[] = []
  const imported = new Set<string>()
  for (const block of blocks) {
    if (block.file) {
      write(block.file, block.code)
      if (block.file.startsWith('src/routes/')) write(join(dirname(block.file), '$types.d.ts'), TYPES_STUB)
      continue
    }
    for (const line of block.code.split('\n')) {
      const named = /^import (type )?\{([^}]*)\} from (.+)$/.exec(line)
      if (!named) {
        fragments.push(line)
        continue
      }
      const names = named[2]!
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n !== '' && !imported.has(n.replace(/^type /, '')))
      for (const n of names) imported.add(n.replace(/^type /, ''))
      if (names.length > 0) fragments.push(`import ${named[1] ?? ''}{ ${names.join(', ')} } from ${named[3]}`)
    }
    fragments.push('')
  }
  if (fragments.length > 0) write('samples.ts', `${fragments.join('\n')}\nexport {}\n`)

  return { dir, files: [...files] }
}

function compile(dir: string, files: string[]): string[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
    typeRoots: [join(ROOT, 'node_modules/@types')],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    isolatedModules: true,
    baseUrl: dir,
    paths: {
      '@loewen-digital/fullstack': [join(ROOT, 'src/index.ts')],
      '@loewen-digital/fullstack/auth/flatdb': [join(ROOT, 'src/auth/adapters/flatdb.ts')],
      '@loewen-digital/fullstack/*': [join(ROOT, 'src/*/index.ts')],
      '$lib/*': [join(dir, 'src/lib/*')],
    },
  }
  const program = ts.createProgram(files, options)
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => ROOT,
    getNewLine: () => '\n',
  }
  return ts.getPreEmitDiagnostics(program).map((d) => ts.formatDiagnostic(d, host).trim())
}

describe('docs samples compile', () => {
  for (const page of PAGES) {
    it(`docs/content/${page}.md`, () => {
      const markdown = readFileSync(join(ROOT, 'docs/content', `${page}.md`), 'utf8')
      const blocks = extractBlocks(markdown)
      expect(blocks.length).toBeGreaterThan(0)

      const { dir, files } = writeSamples(page, blocks)
      expect(compile(dir, files)).toEqual([])
    })
  }

  it('reports a sample that does not compile (harness self-check)', () => {
    const { dir, files } = writeSamples('self-check', [
      { file: null, code: "import { createAuth } from '@loewen-digital/fullstack/auth'\ncreateAuth({}, { db: 42 })" },
      { file: 'src/routes/x/+page.server.ts', code: "import type { PageServerLoad } from './$types'\nexport const load: PageServerLoad = () => 42" },
    ])
    const diagnostics = compile(dir, files)
    expect(diagnostics.some((d) => d.includes('samples.ts'))).toBe(true)
    expect(diagnostics.some((d) => d.includes('+page.server.ts'))).toBe(true)
  })
})
