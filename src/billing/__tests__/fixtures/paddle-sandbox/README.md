# Paddle sandbox recording

Nine notifications Paddle's sandbox delivered on 2026-10-09 to a Worker running this driver, in
the order they occurred: a one-time purchase, a subscription that is canceled for the end of its
period, taken back, canceled at once, and whose payment is then refunded in the dashboard. Every
one passed signature verification before it was kept.

Scrubbed before they were committed: the payloads are cut down to the envelope and the fields a
billing driver can have a use for, the customer id is replaced, and nothing about the customer
(name, address, email, payment method) is left. They carry no secret and no signature; a test signs
them with a secret it makes up for the run. The price, product, transaction and subscription ids
are those of a throwaway sandbox account.

`custom_data.userId` is what `billing.checkout()` sent; Paddle copied it from the transaction onto
the subscription. Events 6 and 7 have the same `occurred_at`: Paddle reports an immediate cancel
with `subscription.canceled` and with a `subscription.updated` in the same state. Events 8 and 9
are one refund of the whole payment, before and after its approval: `type` is `partial` and the
one item is `full`, which is how the dashboard sends it.
