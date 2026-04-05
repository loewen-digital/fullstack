#!/usr/bin/env node
import { migrateRun, migrateRollback, migrateStatus } from './migrate.js'
import { seedRun } from './seed.js'
import { generateMigration, generateFactory, generateSeed } from './generate.js'

const args = process.argv.slice(2)
const [command, subcommand, ...rest] = args

function printHelp(): void {
  console.log(`
Usage: fullstack <command> [options]

Commands:
  migrate                  Run all pending migrations
  migrate:rollback         Roll back the last migration
  migrate:status           Show applied migration status

  seed [file]              Run database seeders

  generate migration <name>  Scaffold a new migration file
  generate factory <name>    Scaffold a new factory file
  generate seed <name>       Scaffold a new seed file

  help                     Show this help message
`.trim())
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'migrate') {
    await migrateRun()
    return
  }

  if (command === 'migrate:rollback') {
    await migrateRollback()
    return
  }

  if (command === 'migrate:status') {
    await migrateStatus()
    return
  }

  if (command === 'seed') {
    await seedRun(subcommand)
    return
  }

  if (command === 'generate') {
    if (subcommand === 'migration') {
      generateMigration(rest[0] ?? '')
      return
    }
    if (subcommand === 'factory') {
      generateFactory(rest[0] ?? '')
      return
    }
    if (subcommand === 'seed') {
      generateSeed(rest[0] ?? '')
      return
    }
    console.error(`Unknown generate target: "${subcommand}". Use: migration, factory, seed`)
    process.exit(1)
  }

  console.error(`Unknown command: "${command}". Run "fullstack help" for usage.`)
  process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
