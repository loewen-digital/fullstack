# 0024 · Billing: the Paddle driver and what it changed in the contract

## Context

#37: Paddle behind `driver: 'paddle'`. Its refunds name a transaction but no price, its
`subscription.updated` also follows a cancel, and its web checkout is Paddle.js on a page of the app.

## Decision

`ProviderEvent.providerId` is optional: billing takes the product of the holding and answers 409
while it is missing, instead of the driver asking Paddle's API inside the webhook. Subscription
events are mapped by the state in them, not by their name. An event that leaves its holding as it
was is skipped as `unchanged`; `subscription.changed` also clears `past_due`. `checkout()` returns
the transaction's payment link (`?_ptxn=`); hosted checkout is left out. Fixtures are Paddle's
documented examples, cut down to the fields a driver reads.

## Consequences

The app needs a page with Paddle.js and sets `successUrl` there. A refund that overtakes its
purchase waits. Run against the sandbox on 2026-10-09; renewal and failed payment were not.
