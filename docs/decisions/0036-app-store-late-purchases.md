# 0036 · Billing: the App Store driver asks Apple about a purchase that is handed over late

## Context

0034 left a gap: the driver asks Apple nothing. A refund Apple reports while nobody has handed the
purchase over gets 409 and is lost after about six days; a transaction posted later unlocks it.
Asking needs a secret, and a request per hand-over ties every start of the app to Apple's API.

## Decision

`apiKey` is optional. With it the driver offers `refresh()` for a transaction Apple signed more
than a day ago: Get Transaction Info, verified and checked like the proof, takes its place. A day,
because Apple retries a notification for days. Billing calls `refresh()`, new on the driver
interface, only when the proof would add something to the account. Failing to ask fails the
hand-over; a transaction Apple does not know is `invalid`. Tests use a fake that checks the token.

## Consequences

Fresh purchases and known ones cost no request. A wrong key shows at the first late hand-over. A
lost end of a subscription stays lost. No real key was tried against Apple yet.
