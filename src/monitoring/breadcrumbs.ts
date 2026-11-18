import type { Breadcrumb, MonitoringFetch } from './types.js'

export interface BreadcrumbOptions {
  /** How many are kept; the oldest goes first */
  max: number
  /** The route pattern of the page the user is on */
  route: () => string | null
  /** The route pattern a request goes to */
  routeOf?: (url: URL) => string | null | undefined
}

export interface BreadcrumbRecorder {
  /** Writes a navigation when the route pattern is another one than at the last look */
  noteRoute(): void
  /** What was recorded, oldest first */
  crumbs(): Breadcrumb[]
  /** The page's `fetch` from before it was wrapped: a request through it leaves no breadcrumb */
  fetch: MonitoringFetch
  stop(): void
}

interface ElementLike {
  tagName?: unknown
  id?: unknown
  className?: unknown
  getAttribute?: (name: string) => string | null
  parentElement?: ElementLike | null
}

const MAX_TARGET = 120

/**
 * An element by what the app's markup calls it: tag, id, the first classes and `name`, with up to
 * two ancestors. Never its text and never a value: both are the user's.
 */
export function describeElement(target: unknown): string | null {
  const parts: string[] = []
  let element = target as ElementLike | null | undefined
  for (let depth = 0; depth < 3 && element && typeof element.tagName === 'string'; depth++) {
    let part = element.tagName.toLowerCase()
    if (typeof element.id === 'string' && element.id !== '') part += `#${element.id}`
    // The class of an SVG element is an object, not a string.
    if (typeof element.className === 'string') {
      const classes = element.className.split(/\s+/).filter(Boolean).slice(0, 3)
      if (classes.length > 0) part += `.${classes.join('.')}`
    }
    const name = typeof element.getAttribute === 'function' ? element.getAttribute('name') : null
    if (name) part += `[name="${name}"]`
    parts.unshift(part)
    element = element.parentElement
  }
  return parts.length > 0 ? parts.join(' > ').slice(0, MAX_TARGET) : null
}

/**
 * Records what happens on the page before an error: clicks, requests and navigations. A request
 * is named by the route pattern the app answers for it, otherwise by its host alone; a navigation
 * by the route patterns it led from and to. No address is kept.
 */
export function recordBreadcrumbs(win: Window, options: BreadcrumbOptions): BreadcrumbRecorder {
  const crumbs: Breadcrumb[] = []
  const now = (): string => new Date().toISOString()
  let lastRoute = options.route()
  let recording = true

  function push(crumb: Breadcrumb): void {
    crumbs.push(crumb)
    if (crumbs.length > options.max) crumbs.splice(0, crumbs.length - options.max)
  }

  function noteRoute(): void {
    const route = options.route()
    if (route === lastRoute) return
    push({ type: 'navigation', timestamp: now(), from: lastRoute, to: route })
    lastRoute = route
  }

  function add(crumb: Breadcrumb): void {
    if (!recording) return
    try {
      noteRoute()
      push(crumb)
    } catch {
      // A breadcrumb is never worth an error of its own.
    }
  }

  function targetOf(address: string): string {
    try {
      const url = new URL(address, win.location.href)
      const pattern = options.routeOf?.(url)
      return typeof pattern === 'string' && pattern !== '' ? pattern : url.host || url.protocol
    } catch {
      return 'unknown'
    }
  }

  function onClick(event: Event): void {
    try {
      const target = describeElement(event.target)
      if (target !== null) add({ type: 'click', timestamp: now(), target })
    } catch {
      // See add().
    }
  }

  const original = win.fetch
  const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const answer = original.call(win, input, init)
    try {
      const request = typeof input === 'string' ? null : input
      const address =
        request === null ? (input as string) : 'href' in request ? request.href : request.url
      const method = (
        init?.method ?? (request !== null && 'method' in request ? request.method : 'GET')
      ).toUpperCase()
      const target = targetOf(address)
      answer.then(
        (response) =>
          add({ type: 'http', timestamp: now(), method, target, status: response.status }),
        () => add({ type: 'http', timestamp: now(), method, target, status: null }),
      )
    } catch {
      // The page's request goes its way whatever happens to the breadcrumb.
    }
    return answer
  } as typeof fetch

  if (typeof original === 'function') win.fetch = wrapped
  win.addEventListener('click', onClick, true)

  return {
    noteRoute,
    crumbs: () => [...crumbs],
    fetch: (input, init) => original.call(win, input, init),
    stop() {
      win.removeEventListener('click', onClick, true)
      // Whoever wrapped fetch after us keeps their wrapper; ours stays inside it, recording nothing.
      if (win.fetch === wrapped) win.fetch = original
      recording = false
    },
  }
}
