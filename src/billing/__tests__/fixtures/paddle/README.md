# Paddle fixtures

Webhook notifications of Paddle Billing, one per event type the driver reads. They are the example
payloads of Paddle's webhook reference (https://developer.paddle.com/webhooks/overview, read
2026-10-09), cut down to the envelope and the fields a billing driver can have a use for; ids and
timestamps are Paddle's. They carry no customer data, no secret and no signature: a test signs a
payload with a secret it makes up for the run.

What Paddle's examples do not show (an approved full refund, a scheduled cancel, a renewal) a test
derives from these files and says so where it does.
