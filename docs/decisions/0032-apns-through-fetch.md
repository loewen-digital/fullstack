# 0032 · Notifications: the APNs driver sends through `fetch`, which decides where it runs

## Context

#51 wants an APNs driver that sends through `fetch` on Node and on Workers. Apple's API is HTTP/2
only. Measured on 2026-11-17: `fetch` reaches Apple from a Worker on Cloudflare's network and on
Node 26; it does not on Node 24, which `engines` names, nor in local workerd (`wrangler dev`).

## Decision

The driver sends through `fetch` only; the package gets no `node:http2` code. On a runtime
without HTTP/2 a delivery fails with a reason that says so, and the docs carry a `fetch` on
`node:http2` to hand over, checked against Apple on Node 24. `BadDeviceToken` removes a device
like `Unregistered`, though Apple also answers it for a token of the other environment. The tag
is the `apns-collapse-id`, `sound` defaults to `'default'`, `sandbox` takes a second key.

## Consequences

An app on Node 24 copies the `fetch` from the docs or moves to Node 26; APNs cannot be tried under
`wrangler dev`. Every Worker isolate signs its own provider token: untested whether Apple minds.
