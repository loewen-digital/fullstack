# 0025 · Entitlements: declared on the products, resolved from the billing account

## Context

#38 wants "may this user use X, how much" in one call and one store read, with grants by hand that
survive billing events. A wrong answer gives paid features away or locks a paying user out.

## Decision

Features and limits sit on the products of the billing config and `billing.entitlements()` resolves
them, instead of a factory of its own: a product key written twice is a typo that locks someone
out. Grants by hand are stored in the account record, so events and grants share one read and one
compare-and-swap, and `applyEvent` never touches them; a grant names a product, `revoke` only takes
back a grant. Holdings got `pastDueSince`, because `updatedAt` moves with every event. Of a limit
the highest value counts. On the request the adapters put a lazy, per-request `entitlements()`.

## Consequences

A bundle that is not for sale needs a product entry. A paid holding cannot be blocked by hand.
Stores of your own keep two more fields. Adapters opt in through `billing` in the stack, no flag.
