// File transport (rotating) — Task 2.2
// Node.js only — uses fs/promises and path

import type { LogEntry, LogTransport } from '../types.js'

export interface FileTransportConfig {
  /** Path to the log file */
  path: string
  /** Max file size in bytes before rotating. Default: 10 MB */
  maxSize?: number
  /** Max number of rotated files to keep. Default: 5 */
  maxFiles?: number
}

export function fileTransport(config: FileTransportConfig): LogTransport {
  const maxSize = config.maxSize ?? 10 * 1024 * 1024
  const maxFiles = config.maxFiles ?? 5
  let currentSize = 0
  let initialized = false
  let rotating = false
  const queue: LogEntry[] = []

  async function init(): Promise<void> {
    const { stat } = await import('node:fs/promises')
    try {
      const s = await stat(config.path)
      currentSize = s.size
    } catch {
      currentSize = 0
    }
    initialized = true
  }

  async function rotate(): Promise<void> {
    if (rotating) return
    rotating = true
    const { rename, unlink } = await import('node:fs/promises')
    // Shift rotated files: .4 → .5 (drop oldest), .3 → .4, …, base → .1
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${config.path}.${i}`
      const to = `${config.path}.${i + 1}`
      try { await rename(from, to) } catch { /* doesn't exist */ }
    }
    try { await unlink(`${config.path}.${maxFiles + 1}`) } catch { /* ignore */ }
    try { await rename(config.path, `${config.path}.1`) } catch { /* ignore */ }
    currentSize = 0
    rotating = false
  }

  async function write(entry: LogEntry): Promise<void> {
    const { appendFile } = await import('node:fs/promises')
    const line = JSON.stringify(entry) + '\n'
    const bytes = new TextEncoder().encode(line).byteLength

    if (currentSize + bytes > maxSize) {
      await rotate()
    }

    await appendFile(config.path, line, 'utf8')
    currentSize += bytes
  }

  return {
    async log(entry: LogEntry): Promise<void> {
      if (!initialized) {
        queue.push(entry)
        if (queue.length === 1) {
          await init()
          for (const queued of queue.splice(0)) {
            await write(queued)
          }
        }
        return
      }
      await write(entry)
    },
  }
}
