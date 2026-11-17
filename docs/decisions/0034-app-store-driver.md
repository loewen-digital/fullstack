# 0034 · Billing: the App Store driver verifies and reads, and asks Apple nothing

## Context

#53: purchases through Apple's in-app purchase. The issue proposes the App Store Server API to
look a transaction up, and tests on recorded payloads. No Apple account with in-app purchases
existed to record from, and the API needs a `.p8` key in the app's config.

## Decision

The driver verifies what Apple signed (ES256, the chain to Apple Root CA - G3, the checks of
Apple's own library, no revocation service) and reads it: no request, no secret. One driver takes
one environment; sandbox is a second provider. The account token is a version 5 UUID of the user
id, and required. A period that is over starts nothing; a failed renewal without a grace period
ends the subscription. Tests sign payloads built from Apple's reference with a chain made per run.

## Consequences

A subscription ends only through notifications, and a transaction handed over after Apple stopped
retrying can be stale, also a refunded one: closing that takes the API key. A recording is due.
