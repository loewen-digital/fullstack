import { defineConfig } from 'vite-plus'

// One entry per subpath export; the key is the path under dist/.
const entries: Record<string, string> = {
  index: 'src/index.ts',
  'config/index': 'src/config/index.ts',
  'validation/index': 'src/validation/index.ts',
  'auth/index': 'src/auth/index.ts',
  'auth/adapters/flatdb': 'src/auth/adapters/flatdb.ts',
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
  'feedback/index': 'src/feedback/index.ts',
  'billing/index': 'src/billing/index.ts',
  'billing/stores/flatdb': 'src/billing/stores/flatdb.ts',
  'usage/index': 'src/usage/index.ts',
  'usage/stores/flatdb': 'src/usage/stores/flatdb.ts',
  'testing/index': 'src/testing/index.ts',
  'adapters/sveltekit/index': 'src/adapters/sveltekit/index.ts',
  'adapters/nuxt/index': 'src/adapters/nuxt/index.ts',
  'adapters/remix/index': 'src/adapters/remix/index.ts',
  'adapters/astro/index': 'src/adapters/astro/index.ts',
  'adapters/fetch/index': 'src/adapters/fetch/index.ts',
  'vite/index': 'src/vite/index.ts',
  'cli/index': 'src/cli/index.ts',
}

export default defineConfig({
  // Library build (tsdown): ESM plus bundled declarations per entry. Every package import stays
  // external (drizzle-orm, better-sqlite3, the framework adapters' hosts, vite, redis, ...).
  pack: {
    entry: entries,
    format: ['esm'],
    platform: 'node',
    // .js and .d.ts like the exports map, not the .mjs tsdown picks for platform node.
    fixedExtension: false,
    target: 'es2022',
    dts: true,
    sourcemap: true,
    deps: { neverBundle: true },
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.d.ts'],
    },
  },
  lint: {
    ignorePatterns: ['dist/', 'docs/', 'examples/'],
    categories: { correctness: 'error' },
    // ESLint and typescript-eslint "recommended" rules that sit outside Oxlint's correctness category.
    rules: {
      'no-array-constructor': 'error',
      'no-case-declarations': 'error',
      'no-empty': 'error',
      'no-fallthrough': 'error',
      'no-prototype-builtins': 'error',
      'no-regex-spaces': 'error',
      'no-unexpected-multiline': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'preserve-caught-error': 'error',
      'typescript/ban-ts-comment': 'error',
      'typescript/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'typescript/no-empty-object-type': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-require-imports': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error',
      // Type-aware rules of the correctness category that do not fit this code base:
      // driver unions like 'smtp' | 'resend' | string are deliberate (known values, open for custom
      // drivers); validation and OAuth stringify unknown input on purpose; unbound-method reports
      // mock references in tests and destructured module functions.
      'typescript/no-redundant-type-constituents': 'off',
      'typescript/no-base-to-string': 'off',
      'typescript/unbound-method': 'off',
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
  },
  fmt: {
    singleQuote: true,
    semi: false,
    printWidth: 100,
    sortPackageJson: false,
    // Code only: Markdown, the docs site and the example app keep their own formatting; the loop
    // workflow is rolled out verbatim from agent-loop/snippets.
    ignorePatterns: [
      'dist',
      'docs',
      'examples',
      '**/*.md',
      'package-lock.json',
      '.github/workflows/agent.yml',
    ],
  },
})
