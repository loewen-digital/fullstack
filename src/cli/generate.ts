import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath)
  if (existsSync(filePath)) {
    console.error(`Error: File already exists: ${filePath}`)
    process.exit(1)
  }
  writeFileSync(filePath, content, 'utf-8')
  console.log(`Created: ${filePath}`)
}

export function generateFactory(name: string): void {
  if (!name) {
    console.error('Error: Factory name is required. Usage: fullstack generate factory <name>')
    process.exit(1)
  }

  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  const fileName = `${name.toLowerCase()}.factory.ts`
  const filePath = resolve(process.cwd(), 'database', 'factories', fileName)

  // One function per field, the shape defineFactory takes; every make() calls them again.
  const content = [
    "import { defineFactory, sequence } from '@loewen-digital/fullstack/testing'",
    '',
    'const seq = sequence()',
    '',
    `export const ${pascal}Factory = defineFactory({`,
    '  // TODO: one function per field',
    '  id: () => seq(),',
    `  name: () => '${pascal} ' + seq(),`,
    '})',
    '',
  ].join('\n')
  writeFile(filePath, content)
}

export function generateSeed(name: string): void {
  if (!name) {
    console.error('Error: Seed name is required. Usage: fullstack generate seed <name>')
    process.exit(1)
  }

  const fileName = `${name.toLowerCase()}.seed.ts`
  const filePath = resolve(process.cwd(), 'database', 'seeds', fileName)

  const content = `import type { DbInstance } from '@loewen-digital/fullstack/db'

export default async function seed(db: DbInstance): Promise<void> {
  // TODO: insert seed data using db.drizzle
}
`
  writeFile(filePath, content)
}
