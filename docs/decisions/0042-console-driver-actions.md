# 0042 · The console driver plays a refund and an end at once

## Context

Opening the console driver's manage link canceled the user's subscriptions, and that was all it could
do: no refund, no end before the period was over, nothing for a purchase paid once (#45).

## Decision

The manage link leads to a page the driver serves from the webhook route, with a link per action a
holding's state allows: cancel at the end of the period, end now, refund. Opening the page changes
nothing; each link is one event, applied once. `createConsoleDriver()` also returns `actionUrl(holding,
action)`, a method because the driver knows its webhook URL. An action names only its holding, as
Paddle's refunds do. The page is made from the link alone, so its events carry the link's moment.

## Consequences

Breaking in development: opening the manage link no longer cancels, and it is `null` with nothing to
manage. The page shows an unsigned link as HTML: all of it is escaped, and a content security policy
lets nothing run. `past_due` and a renewal are still not played.
