/**
 * Type-checks the ```ts blocks of a docs page against the package source, the way a SvelteKit 2
 * project with `strict: true` would compile them. `docs.test.ts` runs it for every page in PAGES.
 *
 * Rules for a page:
 * - A block whose first line is `// <path>.ts` (or `.tsx`) is written to that path. Files under
 *   `src/routes/` get a `./$types` stub next to them, `$lib/*` points at the page's `src/lib/`,
 *   `~/*` at its `app/`, and `$env/dynamic/private`, the Workers globals `R2Bucket` and
 *   `ScheduledEvent`, and the slices of h3, Astro and Remix the adapter pages use are stubbed.
 * - Every other block is appended, in order, to one module per page, so a later block may use
 *   what an earlier one declared. Names an earlier block already imported are dropped from
 *   later named imports.
 */
import ts from 'typescript'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
// Inside node_modules, so that bare imports (@sveltejs/kit, @types/node) resolve from the samples.
const OUT = join(ROOT, 'node_modules/.cache/docs-samples')

export const PAGES = [
  'getting-started/installation',
  'getting-started/quick-start',
  'getting-started/configuration',
  'core-concepts/factory-functions',
  'core-concepts/driver-pattern',
  'core-concepts/web-standards',
  'modules/auth',
  'modules/session',
  'modules/security',
  'adapters/sveltekit',
  'adapters/nuxt',
  'adapters/remix',
  'adapters/astro',
  'guides/auth-on-flatdb',
]

const ENV_STUB = `declare module '$env/dynamic/private' {
  export const env: Record<string, string | undefined>
}
`
const WORKERS_STUB = `import type { R2BucketLike } from '@loewen-digital/flatdb'
declare global {
  type R2Bucket = R2BucketLike
  interface ScheduledEvent {
    cron: string
    scheduledTime: number
  }
}
export {}
`
const TYPES_STUB = `import type { Actions as KitActions, RequestHandler as KitRequestHandler, ServerLoad } from '@sveltejs/kit'
export type PageServerLoad = ServerLoad
export type Actions = KitActions
export type RequestHandler = KitRequestHandler
`

/**
 * The slice of h3, Astro and Remix the adapter pages touch, modelled on the frameworks' public
 * types so the samples prove the adapter API without the frameworks as devDependencies
 * (decision 0007). `App.Locals` is Astro's; `@sveltejs/kit` declares the same interface.
 */
const FRAMEWORKS_STUB = `declare module 'h3' {
  import type { IncomingMessage, ServerResponse } from 'node:http'
  export interface H3EventContext {
    [key: string]: unknown
  }
  export interface H3Event {
    node: { req: IncomingMessage; res: ServerResponse }
    context: H3EventContext
    path: string
    method: string
  }
  export type EventHandler<T = unknown> = (event: H3Event) => T | Promise<T>
  export function defineEventHandler<T>(handler: EventHandler<T>): EventHandler<T>
  export function createError(input: { statusCode?: number; statusMessage?: string; message?: string; data?: unknown }): Error
}
declare namespace App {
  interface Locals {}
}
declare module 'astro' {
  import type { AstroAPIContext } from '@loewen-digital/fullstack/adapters/astro'
  export interface AstroCookie {
    value: string
    json(): unknown
    number(): number
    boolean(): boolean
  }
  export interface AstroCookies {
    get(key: string): AstroCookie | undefined
    has(key: string): boolean
    set(key: string, value: string | number | boolean | object, options?: Record<string, unknown>): void
    delete(key: string, options?: Record<string, unknown>): void
    headers(): Generator<string, void, unknown>
  }
  export interface APIContext extends Omit<AstroAPIContext, 'locals' | 'cookies'> {
    locals: App.Locals
    cookies: AstroCookies
    redirect(path: string, status?: 301 | 302 | 303 | 307 | 308): Response
  }
  export type MiddlewareNext = () => Promise<Response>
  export type MiddlewareHandler = (context: APIContext, next: MiddlewareNext) => Promise<Response> | Response
  export type APIRoute = (context: APIContext) => Response | Promise<Response>
}
declare module 'astro:middleware' {
  import type { MiddlewareHandler } from 'astro'
  export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler
  export function sequence(...handlers: MiddlewareHandler[]): MiddlewareHandler
}
declare module 'astro:env/server' {
  export function getSecret(key: string): string | undefined
}
declare module '@remix-run/node' {
  export interface AppLoadContext {
    [key: string]: unknown
  }
  export interface LoaderFunctionArgs {
    request: Request
    params: Record<string, string | undefined>
    context: AppLoadContext
  }
  export type ActionFunctionArgs = LoaderFunctionArgs
  export function json<T>(data: T, init?: number | ResponseInit): Response
  export function redirect(url: string, init?: number | ResponseInit): Response
}
`

export interface Block {
  file: string | null
  code: string
}

export function extractBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '```ts') continue
    const start = i + 1
    let end = start
    while (end < lines.length && lines[end] !== '```') end++
    const code = lines.slice(start, end)
    const header = /^\/\/ ([\w./+-]+\.tsx?)$/.exec(code[0] ?? '')
    blocks.push({ file: header?.[1] ?? null, code: code.join('\n') })
    i = end
  }
  return blocks
}

export function writeSamples(name: string, blocks: Block[]): { dir: string; files: string[] } {
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
  write('workers.d.ts', WORKERS_STUB)
  write('frameworks.d.ts', FRAMEWORKS_STUB)

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

export function compile(dir: string, files: string[]): string[] {
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
    jsx: ts.JsxEmit.Preserve,
    baseUrl: dir,
    paths: {
      '@loewen-digital/fullstack': [join(ROOT, 'src/index.ts')],
      '@loewen-digital/fullstack/auth/flatdb': [join(ROOT, 'src/auth/adapters/flatdb.ts')],
      '@loewen-digital/fullstack/*': [join(ROOT, 'src/*/index.ts')],
      '$lib/*': [join(dir, 'src/lib/*')],
      '~/*': [join(dir, 'app/*')],
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
