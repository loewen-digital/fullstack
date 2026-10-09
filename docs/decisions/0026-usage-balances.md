# 0026 · Usage: balances in one record per subject, spent with a compare-and-swap

## Context

#39 wants counted balances that calls at the same time cannot overspend, with one persistent
store on Workers. It proposes a SQL store (a D1 binding) next to a flatdb store.

## Decision

Memory and flatdb ship, no SQL store: flatdb on `R2Adapter` is the store on Workers, and Cloudflare
services stay opt-in. `UsageStore` is `read` and `transact` on one JSON record per subject, like
the billing store; every rule is a pure function. A budget stores what was spent per period and
`left` is the amount minus that, so a renewal needs no write and a new plan counts at once. The
flatdb store repeats the file-name and retry code of billing's instead of importing it: both
modules stay standalone.

## Consequences

A spend is a read and a conditional write. Totals are sums per period and tag for one subject; no
log of single spends, none across subjects. A later SQL store fits behind a version column.
