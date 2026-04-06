/**
 * Application stack — configure all modules here and export a single
 * `stack` instance used throughout the app.
 */

import { defineConfig, createStack } from '@loewen-digital/fullstack'
import * as schema from './schema.js'
import { createAuthAdapter } from './auth-adapter.js'

export { schema }

const config = defineConfig({
  db: {
    driver: 'sqlite',
    url: process.env.DATABASE_URL ?? './blog.db',
    migrations: './migrations',
  },
  auth: {
    sessionTtl: 7 * 24 * 3600, // 7 days
  },
  session: {
    driver: 'cookie',
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-production',
    maxAge: '7d',
  },
  security: {
    csrf: true,
  },
  mail: {
    driver: 'console',
    from: process.env.MAIL_FROM ?? 'blog@example.com',
  },
  logging: {
    level: 'info',
    format: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
  },
})

// Initialise the stack (all modules above are wired up automatically).
// Auth needs a DB adapter so we pass it in the second argument.
const baseStack = createStack(config)

const authDb = createAuthAdapter(baseStack.db.drizzle)
export const stack = createStack(config, { authDb })
