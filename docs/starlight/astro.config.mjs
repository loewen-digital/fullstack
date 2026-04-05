import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  integrations: [
    starlight({
      title: '@loewen-digital/fullstack',
      description: 'Laravel for JS — backend primitives for any meta-framework',
      social: {
        github: 'https://github.com/loewen-digital/fullstack',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
            { label: 'Configuration', slug: 'getting-started/configuration' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Factory Functions', slug: 'core-concepts/factory-functions' },
            { label: 'Driver Pattern', slug: 'core-concepts/driver-pattern' },
            { label: 'Web Standards', slug: 'core-concepts/web-standards' },
          ],
        },
        {
          label: 'Modules',
          items: [
            { label: 'Validation', slug: 'modules/validation' },
            { label: 'Logging', slug: 'modules/logging' },
            { label: 'Events', slug: 'modules/events' },
            { label: 'i18n', slug: 'modules/i18n' },
            { label: 'Database', slug: 'modules/db' },
            { label: 'Auth', slug: 'modules/auth' },
            { label: 'Session', slug: 'modules/session' },
            { label: 'Security', slug: 'modules/security' },
            { label: 'Mail', slug: 'modules/mail' },
            { label: 'Storage', slug: 'modules/storage' },
            { label: 'Cache', slug: 'modules/cache' },
            { label: 'Queue', slug: 'modules/queue' },
            { label: 'Permissions', slug: 'modules/permissions' },
            { label: 'Notifications', slug: 'modules/notifications' },
            { label: 'Search', slug: 'modules/search' },
            { label: 'Webhooks', slug: 'modules/webhooks' },
            { label: 'Realtime', slug: 'modules/realtime' },
          ],
        },
        {
          label: 'Adapters',
          items: [
            { label: 'SvelteKit', slug: 'adapters/sveltekit' },
            { label: 'Nuxt', slug: 'adapters/nuxt' },
            { label: 'Remix', slug: 'adapters/remix' },
            { label: 'Astro', slug: 'adapters/astro' },
          ],
        },
        {
          label: 'Testing',
          items: [
            { label: 'Overview', slug: 'testing/overview' },
            { label: 'Fakes', slug: 'testing/fakes' },
            { label: 'Factories', slug: 'testing/factories' },
          ],
        },
        {
          label: 'Tooling',
          items: [
            { label: 'CLI', slug: 'tooling/cli' },
            { label: 'Vite Plugin', slug: 'tooling/vite-plugin' },
            { label: 'Dev UI', slug: 'tooling/dev-ui' },
          ],
        },
      ],
    }),
  ],
})

