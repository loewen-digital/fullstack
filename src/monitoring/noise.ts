import type { ErrorReport } from './types.js'

/**
 * Messages that are no fault of the app. A pattern is tried on the message and on
 * `<type>: <message>`. The list ran against real traffic: add to it, and take nothing out without
 * a test that shows why.
 */
export const IGNORED_MESSAGES: readonly RegExp[] = [
  // The user's network, a navigation during a request, an ad blocker
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|cancelled|abgebrochen)$/i,
  /^AbortError/,
  /The operation was aborted/,
  // A chunk after a deploy: the old page asks for a file that is gone, a reload solves it
  /Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i,
  // In-app browsers and extensions that inject code into the page
  /__gCrWeb|__firefox__|safari-extension|instantSearchSDKJSBridgeClearHighlight/,
  /^Can't find variable: (gmo|_AutofillCallbackHandler)$/,
  /^Java exception was raised during method invocation$/,
  /can't redefine non-configurable property "solana"/,
  /^Cannot redefine property: googletag$/,
  // A script of another origin: the browser tells the page nothing but that it failed
  /^Script error\.?$/,
  /^Javascript error: Script error\.? on line 0$/,
  // The browser's remark that a ResizeObserver callback was slow
  /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)\.?$/,
]

/**
 * Messages of code that in-app browsers inject, dropped only when no frame of the stack is the
 * app's own. An app inside an iOS shell talks to its shell through `messageHandlers`: with one of
 * its own scripts in the stack, the fault is the app's and is reported.
 */
export const INJECTED_MESSAGES: readonly RegExp[] = [/window\.webkit\.messageHandlers/]

/** Scripts that are not the app's, by the address of the newest frame */
export const IGNORED_SCRIPTS: readonly RegExp[] = [
  /^(chrome|moz|safari|safari-web|ms-browser|opera)-extension:\/\//,
  /^webkit-masked-url:/,
  // The page as Google Translate serves it, rewritten
  /translate\.goog(le)?/,
]

/** Crawlers, uptime checks and headless browsers: what fails there fails for no person */
export const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom/i

export interface NoiseOptions {
  /** The origins the app's own scripts come from, like `https://app.example` */
  origins: readonly string[]
  ignoreMessages?: readonly (string | RegExp)[]
  ignoreScripts?: readonly RegExp[]
}

/** A pattern that answers the same for the same text: a `g` or `y` flag would make it remember */
function stateless(pattern: RegExp): RegExp {
  return /[gy]/.test(pattern.flags)
    ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
    : pattern
}

/**
 * Create the filter of the browser reporter: `true` for a report that is noise. It keeps the
 * last report in mind and drops one that repeats it, so an error in a loop is reported once.
 */
export function createNoiseFilter(options: NoiseOptions): (report: ErrorReport) => boolean {
  const messages = [...IGNORED_MESSAGES, ...(options.ignoreMessages ?? [])].map((pattern) =>
    typeof pattern === 'string' ? pattern : stateless(pattern),
  )
  const scripts = [...IGNORED_SCRIPTS, ...(options.ignoreScripts ?? [])].map(stateless)
  const origins = options.origins.map((origin) => origin.replace(/\/+$/, ''))
  let last = ''

  const isOwn = (file: string): boolean =>
    origins.some((origin) => file === origin || file.startsWith(`${origin}/`))

  return function isNoise(report) {
    const texts = [report.message, `${report.type}: ${report.message}`]
    const says = (pattern: string | RegExp): boolean =>
      texts.some((text) =>
        typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text),
      )
    if (messages.some(says)) return true

    // The newest frame that names a script says whose code threw. A stack without one passes.
    const top = report.frames.find((frame) => frame.file !== undefined)
    if (top?.file !== undefined) {
      const file = top.file
      if (scripts.some((pattern) => pattern.test(file)) || !isOwn(file)) return true
    }
    if (
      INJECTED_MESSAGES.some(says) &&
      !report.frames.some((frame) => frame.file !== undefined && isOwn(frame.file))
    ) {
      return true
    }

    const key = `${report.type}|${report.message}|${top?.file ?? ''}|${top?.line ?? ''}`
    if (key === last) return true
    last = key
    return false
  }
}
