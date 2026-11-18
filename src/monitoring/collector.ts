/**
 * The collector: a script for the head of the page, before every other script. It keeps the
 * errors that are thrown while the app's own code is still loading, 20 at most, and the browser
 * reporter takes them over when it starts.
 *
 * Its source is fixed, so a Content Security Policy can name it by `EARLY_ERROR_COLLECTOR_HASH`.
 * Put it into the page exactly as it is: `<script>${EARLY_ERROR_COLLECTOR}</script>`, with no
 * space or line break around it, or the hash no longer fits.
 */
export const EARLY_ERROR_COLLECTOR =
  '(function(w){var q={events:[],stop:function(){w.removeEventListener("error",p);w.removeEventListener("unhandledrejection",p)}};function p(e){if(q.events.length<20)q.events.push(e)}w.addEventListener("error",p);w.addEventListener("unhandledrejection",p);w.__earlyErrors=q})(window);'

/** The hash of the collector for `script-src`; a header takes it in single quotes */
export const EARLY_ERROR_COLLECTOR_HASH = 'sha256-ngo6L8Dguv/hxWy7ynElo9X3a4oWGC276Kro5vzqfG4='

/** What the collector leaves on `window.__earlyErrors` */
export interface EarlyErrors {
  events: Event[]
  stop(): void
}
