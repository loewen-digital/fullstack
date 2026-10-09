# 0023 · Billing: one record per user, written with a compare-and-swap

## Context

#36 asks that every provider event takes effect exactly once, also when delivered twice at once.
The plan was an event collection with flatdb's `unique` plus a state document per user. Two writes
leave a gap: after a crash between them the event counts as handled while the purchase is missing.

## Decision

One record per user holds the holdings and the ids of the applied events; `BillingStore.transact`
changes it atomically. The flatdb store uses `readVersioned`/`writeIf` on the storage adapter and
refuses an adapter without them; `unique` is not used. `handleWebhook` returns the applied events
instead of calling listeners and answers 409 for an event without a user. The console driver
completes a checkout through the app's own webhook route, the same code path as a provider's.

## Consequences

Account files are no flatdb collection: no `find` across users. Applied ids are never cut. The app's
side effects are at-most-once unless it handles `duplicate` entries. The route needs `GET` too.
