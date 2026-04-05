import type { Plugin, ViteDevServer } from 'vite'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from '../config/index.js'
import type { FullstackConfig } from '../config/types.js'
import {
  devStoreGetMail,
  devStoreGetJobs,
  devStoreGetLogs,
  devStoreGetCacheEntries,
  devStoreClearMail,
  devStoreClearJobs,
  devStoreClearLogs,
} from '../dev-store/index.js'

export interface FullstackPluginOptions {
  /** Path to config file root dir. Defaults to Vite project root. */
  configRoot?: string
  /** Whether to generate fullstack.d.ts with virtual module types on build. Defaults to true. */
  generateTypes?: boolean
}

/**
 * Vite plugin for @loewen-digital/fullstack.
 *
 * - Auto-loads fullstack.config.ts
 * - Watches config for changes in dev
 * - Exposes loaded config via `virtual:fullstack/config`
 * - Generates fullstack.d.ts with virtual module type declarations
 * - Mounts Dev UI at /__fullstack/ in dev mode
 */
export function fullstackPlugin(options: FullstackPluginOptions = {}): Plugin {
  let resolvedConfig: FullstackConfig = {}
  let viteRoot = process.cwd()
  const generateTypes = options.generateTypes ?? true

  return {
    name: 'vite-plugin-fullstack',
    enforce: 'pre',

    async configResolved(viteConfig) {
      viteRoot = options.configRoot ?? viteConfig.root ?? process.cwd()
      resolvedConfig = await loadConfig(viteRoot)
    },

    // ── Type generation ────────────────────────────────────────────────────
    async buildStart() {
      if (generateTypes) {
        emitTypeDeclaration(viteRoot, resolvedConfig)
      }
    },

    // ── Virtual module ─────────────────────────────────────────────────────
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

    // ── Dev server ─────────────────────────────────────────────────────────
    configureServer(server: ViteDevServer) {
      const configFiles = [
        `${viteRoot}/fullstack.config.ts`,
        `${viteRoot}/fullstack.config.js`,
      ]

      for (const file of configFiles) server.watcher.add(file)

      server.watcher.on('change', async (changedFile: string) => {
        if (configFiles.includes(changedFile)) {
          console.log('[fullstack] Config changed, reloading...')
          resolvedConfig = await loadConfig(viteRoot)
          if (generateTypes) emitTypeDeclaration(viteRoot, resolvedConfig)
          const mod = server.moduleGraph.getModuleById('\0virtual:fullstack/config')
          if (mod) server.moduleGraph.invalidateModule(mod)
          server.ws.send({ type: 'full-reload' })
        }
      })

      // Mount Dev UI and REST API
      server.middlewares.use('/__fullstack', (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0]!

        // ── API endpoints ──────────────────────────────────────────────────
        if (url.startsWith('/api/')) {
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')

          if (url === '/api/mail') {
            res.end(JSON.stringify(devStoreGetMail()))
            return
          }
          if (url === '/api/mail/clear' && req.method === 'POST') {
            devStoreClearMail()
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (url === '/api/queue') {
            res.end(JSON.stringify(devStoreGetJobs()))
            return
          }
          if (url === '/api/queue/clear' && req.method === 'POST') {
            devStoreClearJobs()
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (url === '/api/logs') {
            res.end(JSON.stringify(devStoreGetLogs()))
            return
          }
          if (url === '/api/logs/clear' && req.method === 'POST') {
            devStoreClearLogs()
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (url === '/api/cache') {
            res.end(JSON.stringify(devStoreGetCacheEntries()))
            return
          }
          if (url === '/api/config') {
            res.end(JSON.stringify(resolvedConfig, null, 2))
            return
          }

          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Not found' }))
          return
        }

        // ── Dev UI HTML ────────────────────────────────────────────────────
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(DEV_UI_HTML)
      })
    },
  }
}

// ── Type declaration generator ───────────────────────────────────────────────

function emitTypeDeclaration(root: string, config: FullstackConfig): void {
  const modules = Object.keys(config).filter(
    (k) => config[k as keyof FullstackConfig] !== undefined,
  )
  const comment = modules.length > 0
    ? `// Active modules: ${modules.join(', ')}`
    : '// No modules configured'

  const dts = `// Auto-generated by @loewen-digital/fullstack Vite plugin — do not edit
${comment}

declare module 'virtual:fullstack/config' {
  import type { FullstackConfig } from '@loewen-digital/fullstack/config'
  const config: FullstackConfig
  export default config
}
`
  try {
    writeFileSync(resolve(root, 'fullstack.d.ts'), dts, 'utf-8')
  } catch {
    // Non-fatal — type file is a convenience, not required
  }
}

// ── Dev UI (self-contained SPA) ──────────────────────────────────────────────

const DEV_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fullstack Dev UI</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f172a;--surface:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#64748b;
  --accent:#6366f1;--green:#22c55e;--red:#ef4444;--yellow:#f59e0b;--cyan:#06b6d4;--purple:#a855f7;
}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;height:100vh;overflow:hidden}
nav{width:200px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:1rem 0;flex-shrink:0}
nav .logo{padding:.75rem 1.25rem 1.25rem;font-weight:700;font-size:.875rem;color:#f1f5f9;border-bottom:1px solid var(--border);margin-bottom:.75rem}
nav .logo span{color:var(--accent)}
nav a{display:flex;align-items:center;gap:.625rem;padding:.5rem 1.25rem;font-size:.8125rem;color:var(--muted);text-decoration:none;border-left:2px solid transparent;transition:all .15s}
nav a:hover{color:var(--text);background:rgba(99,102,241,.08)}
nav a.active{color:var(--accent);border-left-color:var(--accent);background:rgba(99,102,241,.1)}
nav .icon{font-size:1rem;width:1.25rem;text-align:center}
main{flex:1;overflow-y:auto;padding:1.75rem 2rem}
h1{font-size:1.125rem;font-weight:600;margin-bottom:1.5rem}
.toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.toolbar h1{margin:0}
.btn{background:var(--surface);border:1px solid var(--border);color:var(--muted);font-size:.75rem;padding:.35rem .75rem;border-radius:.375rem;cursor:pointer;transition:all .15s}
.btn:hover{color:var(--text);border-color:var(--muted)}
.btn.danger:hover{color:var(--red);border-color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:.8125rem}
th{text-align:left;color:var(--muted);font-weight:500;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;padding:.5rem .75rem;border-bottom:1px solid var(--border)}
td{padding:.6rem .75rem;border-bottom:1px solid rgba(51,65,85,.5);vertical-align:top;word-break:break-all;max-width:320px}
tr:last-child td{border-bottom:none}
.empty{color:var(--muted);font-size:.875rem;padding:2rem;text-align:center}
.badge{display:inline-flex;align-items:center;font-size:.7rem;padding:.15rem .5rem;border-radius:9999px;font-weight:500;white-space:nowrap}
.badge.green{background:rgba(34,197,94,.12);color:var(--green)}
.badge.red{background:rgba(239,68,68,.12);color:var(--red)}
.badge.yellow{background:rgba(245,158,11,.12);color:var(--yellow)}
.badge.blue{background:rgba(99,102,241,.12);color:#818cf8}
.badge.muted{background:rgba(100,116,139,.12);color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:.75rem;padding:1.25rem;margin-bottom:.75rem}
.card h3{font-size:.875rem;font-weight:600;margin-bottom:.25rem}
.card .meta{font-size:.75rem;color:var(--muted);margin-bottom:.75rem}
.card pre{font-size:.75rem;background:rgba(0,0,0,.3);border-radius:.375rem;padding:.75rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;color:#a5f3fc}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem;margin-bottom:1.5rem}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:.75rem;padding:1rem 1.25rem}
.stat .val{font-size:1.75rem;font-weight:700;margin-bottom:.25rem}
.stat .lbl{font-size:.75rem;color:var(--muted)}
.level-debug{color:var(--cyan)}
.level-info{color:var(--green)}
.level-warn{color:var(--yellow)}
.level-error,.level-fatal{color:var(--red)}
#page{display:block}
</style>
</head>
<body>
<nav>
  <div class="logo">@<span>fullstack</span></div>
  <a href="#overview" class="nav-link"><span class="icon">◈</span>Overview</a>
  <a href="#mail" class="nav-link"><span class="icon">✉</span>Mail</a>
  <a href="#queue" class="nav-link"><span class="icon">⚡</span>Queue</a>
  <a href="#logs" class="nav-link"><span class="icon">📋</span>Logs</a>
  <a href="#cache" class="nav-link"><span class="icon">⚙</span>Cache</a>
  <a href="#config" class="nav-link"><span class="icon">⚙</span>Config</a>
</nav>
<main id="page"></main>

<script>
const BASE = '/__fullstack/api'
let refreshTimer = null

async function api(path, method='GET') {
  const r = await fetch(BASE + path, {method})
  return r.json()
}

function post(path) { return api(path, 'POST') }

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function relTime(iso) {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 1000) return 'just now'
  if (d < 60000) return Math.floor(d/1000) + 's ago'
  if (d < 3600000) return Math.floor(d/60000) + 'm ago'
  return new Date(iso).toLocaleTimeString()
}

function badge(text, color) {
  return '<span class="badge ' + color + '">' + esc(text) + '</span>'
}

// ── Pages ──────────────────────────────────────────────────────────────────

async function pageOverview() {
  const [mail, jobs, logs, cache] = await Promise.all([
    api('/mail'), api('/queue'), api('/logs'), api('/cache')
  ])
  const failedJobs = jobs.filter(j => j.status === 'failed')
  const errLogs = logs.filter(l => l.level === 'error' || l.level === 'fatal')
  return \`
<h1>Overview</h1>
<div class="grid2">
  <div class="stat"><div class="val">\${mail.length}</div><div class="lbl">Emails sent</div></div>
  <div class="stat"><div class="val">\${jobs.filter(j=>j.status==='pending').length}</div><div class="lbl">Jobs pending</div></div>
  <div class="stat"><div class="val" style="color:\${failedJobs.length?'var(--red)':'inherit'}">\${failedJobs.length}</div><div class="lbl">Failed jobs</div></div>
  <div class="stat"><div class="val">\${cache.length}</div><div class="lbl">Cache keys</div></div>
  <div class="stat"><div class="val">\${logs.length}</div><div class="lbl">Log entries</div></div>
  <div class="stat"><div class="val" style="color:\${errLogs.length?'var(--red)':'inherit'}">\${errLogs.length}</div><div class="lbl">Errors logged</div></div>
</div>
<p style="font-size:.75rem;color:var(--muted)">Auto-refreshes every 5 seconds. Navigate to a section for details.</p>\`
}

async function pageMail() {
  const items = await api('/mail')
  const rows = items.length ? items.map(m => \`
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem">
    <div>
      <h3>\${esc(m.subject)}</h3>
      <div class="meta">To: \${esc(m.to)}\${m.from?' · From: '+esc(m.from):''} · \${relTime(m.timestamp)}</div>
    </div>
  </div>
  \${m.text ? '<pre>' + esc(m.text.slice(0,600)) + (m.text.length>600?'…':'') + '</pre>' : ''}
  \${m.html && !m.text ? '<pre>[HTML] ' + esc(m.html.slice(0,400)) + '…</pre>' : ''}
</div>\`).join('') : '<div class="empty">No emails captured yet.<br>Use the console mail driver and send an email.</div>'
  return \`
<div class="toolbar"><h1>Mail</h1><button class="btn danger" onclick="clearSection('/mail/clear','mail')">Clear</button></div>
\${rows}\`
}

async function pageQueue() {
  const items = await api('/queue')
  const statusBadge = s => ({
    pending: badge(s,'yellow'), processing: badge(s,'blue'),
    completed: badge(s,'green'), failed: badge(s,'red')
  }[s] ?? badge(s,'muted'))
  const rows = items.length ? \`
<table>
  <thead><tr><th>Job</th><th>Status</th><th>Attempts</th><th>Enqueued</th><th>Reason</th></tr></thead>
  <tbody>\${items.map(j => \`<tr>
    <td>\${esc(j.name)}<br><span style="color:var(--muted);font-size:.7rem">\${esc(JSON.stringify(j.payload).slice(0,80))}</span></td>
    <td>\${statusBadge(j.status)}</td>
    <td>\${j.attempts}/\${j.maxAttempts}</td>
    <td style="white-space:nowrap">\${relTime(j.enqueuedAt)}</td>
    <td>\${j.failedReason ? '<span style="color:var(--red)">' + esc(j.failedReason) + '</span>' : ''}</td>
  </tr>\`).join('')}</tbody>
</table>\` : '<div class="empty">No jobs dispatched yet.</div>'
  return \`<div class="toolbar"><h1>Queue</h1><button class="btn danger" onclick="clearSection('/queue/clear','queue')">Clear</button></div>\${rows}\`
}

async function pageLogs() {
  const items = await api('/logs')
  const rows = items.length ? \`
<table>
  <thead><tr><th>Time</th><th>Level</th><th>Message</th><th>Context</th></tr></thead>
  <tbody>\${items.map(l => \`<tr>
    <td style="white-space:nowrap;color:var(--muted)">\${l.timestamp.slice(11,23)}</td>
    <td><span class="level-\${l.level}">\${l.level.toUpperCase()}</span></td>
    <td>\${esc(l.message)}</td>
    <td style="font-size:.7rem;color:var(--muted)">\${l.context && Object.keys(l.context).length ? esc(JSON.stringify(l.context)) : ''}</td>
  </tr>\`).join('')}</tbody>
</table>\` : '<div class="empty">No log entries yet.<br>Use the console transport to capture logs.</div>'
  return \`<div class="toolbar"><h1>Logs</h1><button class="btn danger" onclick="clearSection('/logs/clear','logs')">Clear</button></div>\${rows}\`
}

async function pageCache() {
  const items = await api('/cache')
  const rows = items.length ? \`
<table>
  <thead><tr><th>Key</th><th>Value</th><th>Expires</th></tr></thead>
  <tbody>\${items.map(c => \`<tr>
    <td><code style="font-size:.75rem">\${esc(c.key)}</code></td>
    <td style="font-size:.75rem">\${esc(JSON.stringify(c.value).slice(0,120))}</td>
    <td style="white-space:nowrap;font-size:.75rem;color:var(--muted)">\${c.expiresAt ? new Date(c.expiresAt).toLocaleTimeString() : '∞ never'}</td>
  </tr>\`).join('')}</tbody>
</table>\` : '<div class="empty">No cache entries.<br>Use the memory cache driver to cache values.</div>'
  return '<div class="toolbar"><h1>Cache</h1></div>' + rows
}

async function pageConfig() {
  const cfg = await api('/config')
  return \`<h1>Config</h1><div class="card"><pre>\${esc(JSON.stringify(cfg,null,2))}</pre></div>\`
}

async function clearSection(path, page) {
  await post(path)
  navigate('#' + page)
}

// ── Router ─────────────────────────────────────────────────────────────────

const PAGES = {
  overview: pageOverview,
  mail: pageMail,
  queue: pageQueue,
  logs: pageLogs,
  cache: pageCache,
  config: pageConfig,
}

let currentPage = 'overview'

async function navigate(hash) {
  clearInterval(refreshTimer)
  const page = (hash || '#overview').replace('#','')
  currentPage = PAGES[page] ? page : 'overview'
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + currentPage)
  })
  const el = document.getElementById('page')
  el.innerHTML = '<div class="empty">Loading…</div>'
  try {
    el.innerHTML = await PAGES[currentPage]()
  } catch(e) {
    el.innerHTML = '<div class="empty" style="color:var(--red)">Error: ' + esc(e.message) + '</div>'
  }
  refreshTimer = setInterval(async () => {
    try { el.innerHTML = await PAGES[currentPage]() } catch {}
  }, 5000)
}

window.addEventListener('hashchange', () => navigate(location.hash))
navigate(location.hash)
</script>
</body>
</html>`

// ── Re-exports ───────────────────────────────────────────────────────────────
export type { FullstackConfig }
