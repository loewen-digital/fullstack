import type { StackFrame } from './types.js'

/** More calls than this say nothing new, and a recursion would fill the report */
const MAX_FRAMES = 50

/** `file:line:column`, line and column optional */
const LOCATION = /^(.*?)(?::(\d+))?(?::(\d+))?$/

/** Firefox names the code of an eval by the script that ran it: `app.js line 3 > eval:1:1` */
const EVALUATED = /^(.*) line (\d+)(?: > (?:eval|Function))+(?::\d+)*$/

const NO_FILE = /^(?:<anonymous>|native|\[native code\]|unknown location|index \d+)?$/

/**
 * The file of a frame as a report carries it. An address loses its query string and fragment:
 * a script in the page itself is named by the page's address, and that part of it is the user's.
 */
function cleanFile(file: string | undefined): string | undefined {
  if (file === undefined || NO_FILE.test(file)) return undefined
  if (file.startsWith('data:')) return 'data:'
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(file) || file.startsWith('blob:')
    ? file.replace(/[?#].*$/, '')
    : file
}

function locate(text: string): Pick<StackFrame, 'file' | 'line' | 'column'> {
  const evaluated = EVALUATED.exec(text)
  if (evaluated) return { file: cleanFile(evaluated[1]), line: Number(evaluated[2]) }
  const [, file, line, column] = LOCATION.exec(text) ?? []
  return {
    file: cleanFile(file),
    ...(line === undefined ? {} : { line: Number(line) }),
    ...(column === undefined ? {} : { column: Number(column) }),
  }
}

function frame(name: string | undefined, where: string): StackFrame | null {
  const { file, line, column } = locate(where)
  const fn = name === undefined || name === '' || name === '<anonymous>' ? undefined : name
  if (fn === undefined && file === undefined) return null
  return {
    ...(file === undefined ? {} : { file }),
    ...(fn === undefined ? {} : { function: fn }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  }
}

/** V8 (Chrome, Edge, Node, workerd): `at name (file:1:2)`, `at file:1:2`, `at async name (...)` */
function v8(line: string): StackFrame | null {
  let text = line.replace(/^at (?:async )?/, '')
  let name: string | undefined
  const open = text.indexOf(' (')
  if (text.endsWith(')') && open !== -1) {
    name = text.slice(0, open).replace(/ \[as [^\]]+\]$/, '')
    text = text.slice(open + 2, -1)
    // `eval at run (https://app.example/a.js:1:2), <anonymous>:1:1`: the script that ran the eval
    if (text.startsWith('eval at ')) text = /\(([^()]+)\)/.exec(text)?.[1] ?? ''
  }
  return frame(name, text)
}

/** Firefox and Safari: `name@file:1:2`, `@file:1:2`, and in Safari the bare `file:1:2` */
function gecko(line: string): StackFrame | null {
  const at = line.indexOf('@')
  // An address can hold an `@` of its own (`/node_modules/@scope/`): then there is no name.
  if (at === -1 || line.slice(0, at).includes('://')) {
    return /:\d+$/.test(line) || line === '[native code]' ? frame(undefined, line) : null
  }
  return frame(
    line.slice(0, at).replace(/^(?:async|promise callback|setTimeout handler)\*/, ''),
    line.slice(at + 1),
  )
}

/**
 * Reads the `stack` of an error into frames, newest call first, for the three engines that write
 * one: V8, Firefox's and Safari's. Anything else, and a value that is no string, gives no frames.
 */
export function parseStack(stack: unknown): StackFrame[] {
  if (typeof stack !== 'string') return []
  const lines = stack.split('\n').map((line) => line.trim())
  // V8 starts with the message, which can run over several lines; only its `at` lines are calls.
  const isV8 = lines.some((line) => line.startsWith('at '))
  const frames: StackFrame[] = []
  for (const line of lines) {
    if (line === '' || (isV8 && !line.startsWith('at '))) continue
    const parsed = isV8 ? v8(line) : gecko(line)
    if (parsed) frames.push(parsed)
    if (frames.length === MAX_FRAMES) break
  }
  return frames
}
