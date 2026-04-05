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

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}

export function generateMigration(name: string): void {
  if (!name) {
    console.error('Error: Migration name is required. Usage: fullstack generate migration <name>')
    process.exit(1)
  }

  const slug = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  const fileName = `${timestamp()}_${slug}.ts`
  const filePath = resolve(process.cwd(), 'drizzle', 'migrations', fileName)

  const content = `import type { AnyDrizzleDb } from '@loewen-digital/fullstack/db'

export async function up(db: AnyDrizzleDb): Promise<void> {
  // TODO: implement migration
}

export async function down(db: AnyDrizzleDb): Promise<void> {
  // TODO: implement rollback
}
`
  writeFile(filePath, content)
}

export function generateFactory(name: string): void {
  if (!name) {
    console.error('Error: Factory name is required. Usage: fullstack generate factory <name>')
    process.exit(1)
  }

  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  const fileName = `${name.toLowerCase()}.factory.ts`
  const filePath = resolve(process.cwd(), 'database', 'factories', fileName)

  const content = `import { defineFactory } from '@loewen-digital/fullstack/testing'

export const ${pascal}Factory = defineFactory<{
  // TODO: define ${pascal} shape
}>({
  definition: () => ({
    // TODO: provide default values
  }),
})
`
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
