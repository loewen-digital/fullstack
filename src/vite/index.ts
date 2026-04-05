import type { Plugin, ViteDevServer } from 'vite'
import { loadConfig } from '../config/index.js'
import type { FullstackConfig } from '../config/types.js'

export interface FullstackPluginOptions {
  /** Path to config file. Defaults to <root>/fullstack.config.ts */
  configFile?: string
}

/**
 * Vite plugin for @loewen-digital/fullstack.
 *
 * - Auto-loads fullstack.config.ts
 * - Watches config for changes in dev
 * - Exposes loaded config to the virtual module `virtual:fullstack/config`
 * - Mounts dev UI middleware at /__fullstack/ in dev mode
 */
export function fullstackPlugin(options: FullstackPluginOptions = {}): Plugin {
  let resolvedConfig: FullstackConfig = {}
  let viteRoot = process.cwd()

  return {
    name: 'vite-plugin-fullstack',
    enforce: 'pre',

    async configResolved(viteConfig) {
      viteRoot = viteConfig.root ?? process.cwd()
      resolvedConfig = await loadConfig(options.configFile ? undefined : viteRoot)
    },

    configureServer(server: ViteDevServer) {
      // Watch fullstack.config.ts for changes
      const configFiles = [
        `${viteRoot}/fullstack.config.ts`,
        `${viteRoot}/fullstack.config.js`,
      ]
      for (const file of configFiles) {
        server.watcher.add(file)
      }

      server.watcher.on('change', async (changedFile: string) => {
        if (configFiles.includes(changedFile)) {
          console.log('[fullstack] Config changed, reloading...')
          resolvedConfig = await loadConfig(viteRoot)
          // Invalidate virtual module so HMR picks up new config
          const mod = server.moduleGraph.getModuleById('\0virtual:fullstack/config')
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
          }
          server.ws.send({ type: 'full-reload' })
        }
      })

      // Mount dev UI middleware
      server.middlewares.use('/__fullstack', (req, res, next) => {
        const url = req.url ?? '/'

        if (url === '/' || url === '') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(renderDevUiIndex(resolvedConfig))
          return
        }

        if (url === '/config') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(resolvedConfig, null, 2))
          return
        }

        next()
      })
    },

    resolveId(id: string) {
      if (id === 'virtual:fullstack/config') {
        return '\0virtual:fullstack/config'
      }
    },

    load(id: string) {
      if (id === '\0virtual:fullstack/config') {
        return `export default ${JSON.stringify(resolvedConfig)}`
      }
    },
  }
}

function renderDevUiIndex(config: FullstackConfig): string {
  const modules = Object.keys(config).filter((k) => config[k as keyof FullstackConfig] !== undefined)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fullstack Dev UI</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
    header h1 { font-size: 1.25rem; font-weight: 600; color: #f1f5f9; }
    header span { font-size: 0.75rem; color: #64748b; background: #0f172a; padding: 0.2rem 0.5rem; border-radius: 9999px; }
    main { padding: 2rem; max-width: 960px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1.25rem; }
    .card h2 { font-size: 0.875rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .card p { font-size: 0.875rem; color: #64748b; }
    .badge { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 9999px; }
    .badge.active { background: #052e16; color: #4ade80; }
    .badge.inactive { background: #1e293b; color: #475569; }
    .section-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 1rem; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>@loewen-digital/fullstack</h1>
    <span>Dev UI</span>
  </header>
  <main>
    <p class="section-title">Active modules</p>
    <div class="grid">
      ${ALL_MODULES.map((mod) => {
        const active = modules.includes(mod)
        return `<div class="card">
          <h2>${mod}</h2>
          <span class="badge ${active ? 'active' : 'inactive'}">${active ? '● enabled' : '○ disabled'}</span>
        </div>`
      }).join('\n      ')}
    </div>
    <p style="margin-top:2rem;font-size:0.8rem;color:#475569;">
      Full config: <a href="/__fullstack/config">/__fullstack/config</a>
    </p>
  </main>
</body>
</html>`
}

const ALL_MODULES = [
  'db', 'auth', 'session', 'security', 'mail', 'storage',
  'cache', 'queue', 'logging', 'events', 'notifications',
  'i18n', 'search', 'permissions', 'webhooks', 'realtime',
]
