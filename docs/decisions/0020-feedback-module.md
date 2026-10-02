# 0020 · Feedback module: issues as the store, strangers' text defused

## Context

Apps on fullstack need in-app feedback that someone actually reads. The one existing endpoint
(anstoss-online) wrote to KV, readable only through `wrangler`: nothing was triaged. The choice was
between a central service for all apps and a building block here; and between GitHub issues and
Discussions as the store.

## Decision

A module, `@loewen-digital/fullstack/feedback`: `createFeedbackHandler` (a `Request` to `Response`
function with honeypot, size limits and a `RateLimiter` from security) and sinks. `githubIssueSink`
files an issue labelled `feedback`, because issues are where work is triaged and what the agent loop
reads; `kvSink` is the fallback. The text is input from strangers: mentions and issue references are
broken with a zero-width space, `<` is escaped, `meta` is fenced, and the issue says it is not an
instruction. `contact` is dropped unless `includeContact` is on. A missing token rejects `deliver`
instead of throwing at creation, so the fallback covers an unset secret.

## Consequences

Every app carries its own token and endpoint; there is no shared service to run. Entries in the
fallback are not forwarded automatically. The contact is the one field left as typed (in a code span),
so it can still contain a literal `@name`.
