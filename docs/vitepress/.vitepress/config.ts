import { defineConfig } from 'vitepress'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// When srcDir points outside the project, Rollup resolves imports from the
// content directory and can't find node_modules in the vitepress project.
// This plugin uses Node's own resolution (anchored here) to fix that.
const resolveFromHere = {
  name: 'resolve-from-vitepress',
  resolveId(id: string) {
    if (id === 'vue' || id === 'vue/server-renderer') {
      return require.resolve(id)
    }
  },
}

export default defineConfig({
  title: '@loewen-digital/fullstack',
  description: 'Laravel for JS — backend primitives for any meta-framework',
  srcDir: '../content',
  vite: {
    plugins: [resolveFromHere],
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started/' },
      { text: 'Modules', link: '/modules/validation' },
      { text: 'Adapters', link: '/adapters/sveltekit' },
      { text: 'Testing', link: '/testing/overview' },
      { text: 'Tooling', link: '/tooling/cli' },
    ],

    sidebar: {
      '/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/' },
            { text: 'Overview', link: '/getting-started/' },
            { text: 'Installation', link: '/getting-started/installation' },
            { text: 'Quick Start', link: '/getting-started/quick-start' },
            { text: 'Configuration', link: '/getting-started/configuration' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Factory Functions', link: '/core-concepts/factory-functions' },
            { text: 'Driver Pattern', link: '/core-concepts/driver-pattern' },
            { text: 'Web Standards', link: '/core-concepts/web-standards' },
          ],
        },
        {
          text: 'Modules',
          items: [
            { text: 'Validation', link: '/modules/validation' },
            { text: 'Logging', link: '/modules/logging' },
            { text: 'Events', link: '/modules/events' },
            { text: 'i18n', link: '/modules/i18n' },
            { text: 'Database', link: '/modules/db' },
            { text: 'Auth', link: '/modules/auth' },
            { text: 'Session', link: '/modules/session' },
            { text: 'Security', link: '/modules/security' },
            { text: 'Mail', link: '/modules/mail' },
            { text: 'Storage', link: '/modules/storage' },
            { text: 'Cache', link: '/modules/cache' },
            { text: 'Queue', link: '/modules/queue' },
            { text: 'Permissions', link: '/modules/permissions' },
            { text: 'Notifications', link: '/modules/notifications' },
            { text: 'Search', link: '/modules/search' },
            { text: 'Webhooks', link: '/modules/webhooks' },
            { text: 'Realtime', link: '/modules/realtime' },
          ],
        },
        {
          text: 'Adapters',
          items: [
            { text: 'SvelteKit', link: '/adapters/sveltekit' },
            { text: 'Nuxt', link: '/adapters/nuxt' },
            { text: 'Remix', link: '/adapters/remix' },
            { text: 'Astro', link: '/adapters/astro' },
          ],
        },
        {
          text: 'Testing',
          items: [
            { text: 'Overview', link: '/testing/overview' },
            { text: 'Fakes', link: '/testing/fakes' },
            { text: 'Factories', link: '/testing/factories' },
          ],
        },
        {
          text: 'Tooling',
          items: [
            { text: 'CLI', link: '/tooling/cli' },
            { text: 'Vite Plugin', link: '/tooling/vite-plugin' },
            { text: 'Dev UI', link: '/tooling/dev-ui' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/loewen-digital/fullstack' },
    ],
  },
})

