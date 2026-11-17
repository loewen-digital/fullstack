# 0033 · Billing: providers by name, and one path for webhooks and proofs

## Context

#52: several providers in one account, and purchases that start on the device. Checked against
#53 and #54 first: Google Play wants a purchase acknowledged after delivery, and its bridge for web
apps sets no account id when buying. Accounts stored so far do not say who sold a holding.

## Decision

`drivers` names every provider and stands instead of `driver`; one `driver` is a provider named
after it. Every stored id carries its provider's name; stores of 0.7 are refused, not guessed at,
and the docs list the rewrite. A purchase belongs to the user who hands its proof over first,
through the store's links. Drivers return an optional `settle()`, called once the events are
stored. `verifyPurchase` throws for a refused proof; with several drivers a call names its provider.

## Consequences

Stores of 0.7 need a one-off rewrite, and renaming a provider orphans its data. A proof without an
account id belongs to whoever hands it over first. #54's criterion on the account id needs rewording.
