# 0041 · Forgetting a subject in usage and a user in billing

## Context

An app that deletes an account has to remove what usage and billing keep about it. Neither could, so
apps deleted the flatdb stores' files themselves and rebuilt how a store names them (#43).

## Decision

`usage.forget(subject)` and `billing.forget(userId)` call `forget` of the store: a required method of
`UsageStore` and `BillingStore`, not an optional one like `deleteExpired` of the auth adapter. A store
that cannot remove what it keeps about a person is not one to run. The flatdb billing store finds a
user's links through the account file (the customer at each provider, every holding), deletes a link
only while it leads to that user, and the account last. No index of links per user, no scan of `refs/`.
Nothing remembers a forgotten user, so an event that names them later starts the account anew.

## Consequences

Breaking for a store of your own. A link the account file does not name stays: one whose event never
reached the account, or a second customer id a provider used for the user.
