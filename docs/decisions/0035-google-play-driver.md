# 0035 · Billing: the Google Play driver reads the purchase as it is, and matches by hand-over

## Context

#54: Google Play Billing in a Trusted Web Activity. The issue wants a purchase matched through an
account id and tests on recordings. The TWA bridge passes no account id, a notification carries
no state, a change of plan is a new token, and no app with products existed to record from.

## Decision

A purchase belongs to the first user who hands it over; no account id is read. Every hand-over
and every notification reads the purchase at Google, and its events are as old as that read. A
holding is the SHA-256 of its token. New in the core for it: `replacesHoldingId` ends the holding a
purchase follows and finds its user, and `acceptUnmatched` answers a delivery nobody matches
instead of 409. Tests run against a fake of Google's API, built from Google's reference.

## Consequences

A purchase nobody posts is in no account, and Google refunds it. A cancel that was taken back and
whose notification was lost heals at the next renewal. A recording and a licence tester run are due.
