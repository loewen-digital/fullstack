import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import dts from 'vite-plugin-dts'

const entries: Record<string, string> = {
  'index': 'src/index.ts',
  'config/index': 'src/config/index.ts',
  'validation/index': 'src/validation/index.ts',
  'auth/index': 'src/auth/index.ts',
  'db/index': 'src/db/index.ts',
  'session/index': 'src/session/index.ts',
  'security/index': 'src/security/index.ts',
  'mail/index': 'src/mail/index.ts',
  'storage/index': 'src/storage/index.ts',
  'cache/index': 'src/cache/index.ts',
  'logging/index': 'src/logging/index.ts',
  'errors/index': 'src/errors/index.ts',
  'queue/index': 'src/queue/index.ts',
  'events/index': 'src/events/index.ts',
  'notifications/index': 'src/notifications/index.ts',
  'i18n/index': 'src/i18n/index.ts',
  'search/index': 'src/search/index.ts',
  'permissions/index': 'src/permissions/index.ts',
  'webhooks/index': 'src/webhooks/index.ts',
  'realtime/index': 'src/realtime/index.ts',
  'testing/index': 'src/testing/index.ts',
  'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
  'adapters/nuxt/index': 'src/adapters/nuxt/index.ts',
  'adapters/remix/index': 'src/adapters/remix/index.ts',
  'adapters/astro/index': 'src/adapters/astro/index.ts',
  'vite/index': 'src/vite/index.ts',
  'cli/index': 'src/cli/index.ts',
}

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      exclude: ['src/**/__tests__/**'],
      tsconfigPath: './tsconfig.build.json',
    }),
  ],
  build: {
    lib: {
      entry: Object.fromEntries(
        Object.entries(entries).map(([key, val]) => [key, resolve(__dirname, val)])
      ),
      formats: ['es'],
    },
    rollupOptions: {
      // Mark all node built-ins and heavy peer deps as external
      external: [
        /^node:/,
        /^drizzle-orm/,
        /^@sveltejs\/kit/,
        /^nuxt/,
        /^@remix-run/,
        /^astro/,
        /^vite/,
        /^redis/,
        /^nodemailer/,
        /^@aws-sdk/,
        /^ioredis/,
        /^citty/,
      ],
    },
    target: 'es2022',
    sourcemap: true,
  },
})
