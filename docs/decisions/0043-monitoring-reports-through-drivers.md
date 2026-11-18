# 0043 · An error report is neutral, a driver knows the server

## Context

#55 asks for error reports to a Sentry-compatible server and proposes `@sentry/browser` with a DSN in the call that
starts it. Every module with I/O here has a driver; one shaped around a provider's SDK would be the exception.

## Decision

A module `monitoring`, not part of `errors`: heartbeat and health are no errors. The reporter builds and scrubs a
report of its own, a driver only sends it. `createSentryDriver` writes the envelope with `fetch` in both runtimes;
no SDK is a dependency, so the module reads the stacks of the three engines itself. The issue's DSN criteria are
that driver's: no DSN, no driver, and a reporter without one starts nothing. `/testing` fakes the driver and the server.

## Consequences

About 6 kB gzipped in the browser instead of 31, and no address or user in a report whatever the driver. Lost: the
SDK's engine edge cases (Firefox's format is tested, Firefox itself was not run), XHR breadcrumbs, a second load (the
collector covers the time before the app's code). A request's breadcrumb has only the host unless `routeOf` names a
pattern. On a server an `http://` DSN stays and a redirect is followed with the body. Not yet run against GlitchTip.
