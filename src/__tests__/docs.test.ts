/**
 * Every ```ts block on the pages in PAGES compiles against the package source; see docs-harness.ts
 * for the rules. A new page joins by adding its path to PAGES.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, PAGES, extractBlocks, writeSamples, compile } from './docs-harness.js'

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
