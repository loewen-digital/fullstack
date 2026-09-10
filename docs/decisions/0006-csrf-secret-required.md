# 0006 · CSRF tokens need a configured secret

## Context

`createSecurity()` signed CSRF tokens with a built-in default secret when `csrf.secret` was missing. A token is
an HMAC over the session id, so with a public secret anyone can mint one for any session. The cookie session
driver started requiring its secret in #6 (decision 0004); CSRF had the same gap.

## Decision

`generateCsrfToken` and `verifyCsrfToken` throw when no `csrf.secret` is configured. `createSecurity()` itself
still builds, so CORS, rate limiting and `sanitize` work without one. No random per-process secret instead: on
Workers every isolate would sign differently and tokens would fail at random, which hides the misconfiguration.

## Consequences

An app with `security` in its stack fails on the first mutating request until `CSRF_SECRET` is set, loudly and
once. `createStack({ security: { csrf: true } })` builds but cannot issue tokens. Tests pass a secret.
