---
title: Billing
description: Checkouts for one-time purchases and subscriptions through Paddle or a driver of your own, and what each user holds, from verified provider events
---

# Billing

`createBilling` takes money through a payment provider and keeps what each user has paid for. The app starts a checkout for a user id and a product, hands the provider's webhooks to the module, and asks what a user holds without calling the provider. The provider sits behind a driver, the state behind a store, and a user is a plain string id: the module needs no other fullstack module, so it works next to `auth` as well as next to an auth of your own.

Nothing is ever granted because a browser came back from a checkout. State changes only through an event the driver verified.

Two drivers ship with the module. `console` takes no money; it is for building the flow before a provider account exists. `paddle` sells through Paddle Billing, see [The Paddle driver](#the-paddle-driver). Going from one to the other is a change of config and secrets, plus the page that opens Paddle's checkout. Any other provider is a [driver of your own](#your-own-driver).

## Import

```ts
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'
import { createFlatdbBillingStore } from '@loewen-digital/fullstack/billing/flatdb'
```

## Setup

Products are declared once, under a key of your choice. `type` says whether the product is paid once and kept or paid per period; `providerId` is the provider's id of what is sold, and it is how an incoming event finds its product.

```ts
// src/lib/server/billing.ts
import { FsAdapter } from '@loewen-digital/flatdb'
import { createBilling } from '@loewen-digital/fullstack/billing'
import { createFlatdbBillingStore } from '@loewen-digital/fullstack/billing/flatdb'

export const billing = createBilling({
  driver: 'console',
  console: { webhookUrl: '/billing/webhook' },
  store: createFlatdbBillingStore({ adapter: new FsAdapter('./data') }),
  products: {
    unlock: { type: 'one-time', providerId: 'pri_unlock' },
    pro: { type: 'subscription', providerId: 'pri_pro' },
  },
})
```

| Option | | |
|---|---|---|
| `driver` | required | `'console'`, `'paddle'`, or a `BillingDriver` |
| `products` | required | What the app sells: `{ [key]: { type, providerId } }`. Two products with the same `providerId` throw |
| `store` | required | Where accounts are kept. There is no default: purchases in the memory of one process are lost with it |
| `console` | optional | Options of the console driver: `webhookUrl` (default `/billing/webhook`), `periodDays` (default 30) |
| `paddle` | with `driver: 'paddle'` | Options of the Paddle driver: `apiKey`, `webhookSecret`, `sandbox`, `checkoutUrl`, `toleranceSeconds` |
| `onError` | optional | Called with what the store or the driver threw inside `handleWebhook` (default: `console.error`) |

## Starting a checkout

```ts
// src/app.d.ts
import type { FullstackLocals } from '@loewen-digital/fullstack/adapters/sveltekit'

declare global {
  namespace App {
    interface Locals extends FullstackLocals {}
  }
}

export {}
```

```ts
// src/routes/billing/checkout/+server.ts
import { error, redirect } from '@sveltejs/kit'
import { billing } from '#lib/server/billing.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.authSession) error(401)

  const checkout = await billing.checkout({
    userId: String(locals.authSession.userId),
    product: 'pro', // a key of `products`; anything else is a type error
    successUrl: '/account',
  })
  if (!checkout.url) error(502, 'this checkout has no page of its own')
  redirect(303, checkout.url)
}
```

`checkout({ userId, product, email?, successUrl?, cancelUrl? })` returns `{ id, url }`: the provider's id of the checkout and the page to send the browser to. `url` is `null` when the provider has no page to send the browser to; its client script takes `id` then. The user's provider customer goes along when billing already knows it, so a returning buyer is not created twice.

Arriving on `successUrl` proves nothing. Show "thank you, your purchase is on its way" there and read the state as below.

## The webhook route

One route takes everything the provider sends. Hand it the untouched `Request`: drivers verify the signature on the raw body.

```ts
// src/routes/billing/webhook/+server.ts
import { billing } from '#lib/server/billing.js'
import type { RequestHandler } from './$types'

const handle: RequestHandler = async ({ request }) => {
  const { response, events } = await billing.handleWebhook(request)

  for (const event of events) {
    if (event.type === 'subscription.canceled') {
      console.log(`user ${event.userId} keeps ${event.product} until`, event.accessEndsAt)
    }
  }
  return response
}

export const POST = handle
export const GET = handle // only the console driver uses GET; a provider's driver answers it with 405
```

`handleWebhook` never throws. It returns the answer for the provider and what the delivery did:

| Field | |
|---|---|
| `response` | What to answer with. `200` when everything was handled; the driver's status (`400`, `401`, `405`) when verification failed; `409` when an event has no user or no purchase to belong to yet; `500` when the store or the driver failed |
| `events` | The events that changed state, matched to your user id and product key. Each event shows up here once, however often it is delivered, and a change the provider tells with two events shows up once |
| `skipped` | The events that changed nothing, as `{ reason, event }` |

A non-2xx answer makes the provider deliver again later, which is what `409` and `500` are for.

| `reason` | |
|---|---|
| `duplicate` | The event was applied before |
| `stale` | A newer event of the same purchase or subscription was applied before; the state stays as it is |
| `unchanged` | The holding already was in the state the event describes: a cancel reported a second time, a failed payment for something the user never held |
| `unmatched` | The event names no user, and neither its purchase nor its customer is linked to one yet; or it names no product, and the purchase it belongs to is not there yet. Answered with `409`: the event that fills the gap may still be on its way |
| `unknown-product` | The provider's product id is not in `products` |

## Events

| `type` | Extra field | What it does to the holding |
|---|---|---|
| `purchase.completed` | | A one-time purchase, `active` |
| `subscription.started` | `currentPeriodEnd` | A subscription, `active` |
| `subscription.renewed` | `currentPeriodEnd` | `active` again, also after a failed payment or a cancel |
| `subscription.changed` | `currentPeriodEnd` | The subscription runs, with this product and period: `active`, also after a cancel or a failed payment. A refund stays a refund |
| `subscription.canceled` | `accessEndsAt` | `canceled`; the user has paid until `accessEndsAt` |
| `payment.failed` | | An `active` subscription becomes `past_due`. Nothing else changes |
| `payment.refunded` | | `refunded`, with `accessEndsAt` set to the time of the first report of the refund |

Every event carries `id` (the provider's), `occurredAt`, `userId`, `product` and `holdingId`.

**Exactly once.** An event is applied once per `id`, also when the provider delivers it twice in the same instant. The ids of the applied events are kept in the same record as the user's holdings and written with them in one step, so there is no moment in which an event counts as handled while its purchase is missing.

**Order.** Deliveries arrive in any order. An event older than the newest one applied to its holding is `stale` and changes nothing: a renewal that arrives after the cancel that followed it does not bring the subscription back. An event for a holding nobody has seen creates it, so a refund that overtakes its purchase is there when the purchase arrives late. The exception is an event without a product (Paddle's refunds name only their transaction): it waits for its purchase and is answered with `409` until then.

**Your own side effects.** `events` is the place for them (a mail, a credit to a balance), but the module cannot make your code exactly-once: if your handler fails after the state was stored and you answer with an error, the redelivery reports the event under `skipped` as `duplicate`. Make a side effect that must not be lost idempotent on `event.id` and run it for `duplicate` entries too.

## What a user holds

```ts
// src/routes/account/+page.server.ts
import { redirect } from '@sveltejs/kit'
import { billing } from '#lib/server/billing.js'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authSession) redirect(302, '/login')
  const userId = String(locals.authSession.userId)

  const { holdings } = await billing.account(userId)
  return {
    holdings: holdings.map(({ product, status, accessEndsAt }) => ({ product, status, accessEndsAt })),
    manageUrl: await billing.manageUrl(userId, { returnUrl: '/account' }),
  }
}
```

`billing.account(userId)` is one read from the store and no call to the provider. It answers `{ userId, customerId, holdings }`; a user billing has never seen has no holdings and `customerId: null`.

| Field of a holding | |
|---|---|
| `id` | The provider's id of the purchase or subscription |
| `product` | The key in `products` |
| `type` | `'one-time'` or `'subscription'` |
| `status` | `active`, `past_due` (the last payment failed and the provider has not given up), `canceled`, `refunded` |
| `startedAt` | The time of the first event |
| `currentPeriodEnd` | Subscriptions: the end of the paid period, or `null` |
| `accessEndsAt` | Set by a cancel and by a refund, otherwise `null` |
| `updatedAt` | The time of the newest event applied |

Holdings are never removed; a canceled or refunded one stays with its status. The module records what happened and leaves the judgement to you: whether `past_due` still unlocks the product, and that `canceled` does until `accessEndsAt`, is a rule of your app.

`billing.manageUrl(userId, { returnUrl? })` returns the link where the user manages or cancels what they bought, or `null` when the provider has nothing to manage for them yet.

## Stores

A store keeps one account per user and the links from provider ids back to users.

| Store | | Holds its guarantee across |
|---|---|---|
| `createMemoryBillingStore()` | Development and tests. Gone with the process | One process |
| `createFlatdbBillingStore({ adapter, prefix? })` | JSON files on the storage adapter your `flatdb()` runs on | What the adapter coordinates, see below |

The flatdb store takes the adapter, not collections: it writes `billing/accounts/<user>.json` and `billing/refs/<kind>/<id>.json` with the adapter's compare-and-swap (`readVersioned` and `writeIf`), which a collection's `update` does not offer. Two events for one user that arrive together are both kept; a writer that lost the race reads again and re-applies its change, twenty times at most, then `handleWebhook` answers `500`. An adapter without the pair is refused when the store is created. It needs `@loewen-digital/flatdb` 0.3 or later.

- **`R2Adapter`**: the swap is on the object's etag and holds across every Worker request and isolate. Build adapter, store and billing per request from `platform.env`, like the database in the [flatdb guide](/guides/auth-on-flatdb).
- **`FsAdapter`**: holds within one process. Two processes on one folder (two dev servers) are not coordinated.
- **`prefix`** (default `billing`) is a folder below the adapter's root. Do not name a collection the same: the files there have no collection index.
- User ids become file names: lower-case letters, digits, `_` and `-` stay, everything else is escaped, so ids that differ only in case stay apart on every file system.

### Your own store

```ts
import type { BillingAccountRecord, BillingStore } from '@loewen-digital/fullstack/billing'

const accounts = new Map<string, BillingAccountRecord>()
const refs = new Map<string, string>()

const store: BillingStore = {
  async getAccount(userId) {
    return accounts.get(userId) ?? null
  },
  async transact(userId, change) {
    const current = accounts.get(userId) ?? { userId, customerId: null, holdings: [], appliedEvents: [] }
    const { account, result } = change(current)
    if (account) accounts.set(userId, account)
    return result
  },
  async link(kind, id, userId) {
    if (!refs.has(`${kind}:${id}`)) refs.set(`${kind}:${id}`, userId)
  },
  async findUserId(kind, id) {
    return refs.get(`${kind}:${id}`) ?? null
  },
}
```

`transact` carries the guarantee: read the account, call `change`, store what it returns, and let no concurrent `transact` for the same user slip in between. On SQL that is a transaction with a row lock or a version column. `change` is free of side effects, so call it again on the fresh account after a lost race; when it returns no `account`, write nothing. `link` keeps the first user an id was linked to.

## The console driver

`driver: 'console'` completes a checkout without a provider. The checkout URL points at your own webhook route (`console.webhookUrl`); opening it is the payment. The driver reads the checkout from the query string, the module applies `purchase.completed` or `subscription.started` exactly like a provider's event, and the browser goes on to `successUrl`. The manage link cancels the user's subscriptions at the end of their period the same way. Reloading either URL delivers the same event id again, which is what a duplicate delivery looks like.

Because the browser arrives with a GET, the webhook route exports `GET` next to `POST`, as above. A redirect only goes to the app's own origin.

The driver signs nothing and charges nothing: whoever can open the URL has "bought". It is a development tool, never a way to sell.

## The Paddle driver

`driver: 'paddle'` sells through [Paddle Billing](https://developer.paddle.com), the current API, not Paddle Classic. Paddle is the merchant of record: it charges and remits the VAT, issues the invoices and handles withdrawals. The driver calls Paddle with `fetch` and verifies webhooks with Web Crypto, so it adds no dependency and runs on Node and on Cloudflare Workers.

```ts
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'

const paddleBilling = createBilling({
  driver: 'paddle',
  paddle: {
    apiKey: process.env.PADDLE_API_KEY!,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
    sandbox: process.env.PADDLE_SANDBOX === 'true',
  },
  store: createMemoryBillingStore(), // your flatdb store, as in Setup
  products: {
    unlock: { type: 'one-time', providerId: 'pri_01h…' }, // the id of a price in Paddle
    pro: { type: 'subscription', providerId: 'pri_01j…' },
  },
})
```

| Option of `paddle` | | |
|---|---|---|
| `apiKey` | required, secret | A server-side API key with the permissions `transaction.write` and `customer_portal_session.write` |
| `webhookSecret` | required, secret | The secret key of the notification destination that delivers to your webhook route |
| `sandbox` | default `false` | Talk to `sandbox-api.paddle.com` instead of `api.paddle.com`. Sandbox and live have separate keys, secrets and price ids |
| `checkoutUrl` | optional | The page of your app that opens the checkout. Default: the default payment link set in Paddle |
| `toleranceSeconds` | default `5` | How far the timestamp of a webhook's signature may be from now. Paddle's own SDKs use 5 |

An empty `apiKey` or `webhookSecret` throws when billing is created, not at the first sale. Neither value appears in an error, an answer or a log line of the driver.

### The checkout page

Paddle has no checkout page of its own for the web: the checkout is an overlay that Paddle.js opens on a page of yours. `billing.checkout()` creates a Paddle transaction with the user id in its custom data and returns `{ id, url }`, where `url` is your page (the default payment link in Paddle, or `checkoutUrl`) with `?_ptxn=<transaction>`. A page that loads Paddle.js opens the checkout for that transaction by itself:

```html
<!-- the page behind the payment link -->
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
  Paddle.Environment.set('sandbox') // leave out in production
  Paddle.Initialize({
    token: 'test_…', // a client-side token from Paddle; public, not the API key
    checkout: { settings: { successUrl: 'https://app.example/account' } },
  })
</script>
```

`successUrl`, `cancelUrl` and `email` of `billing.checkout()` have no server-side counterpart in Paddle; set them in Paddle.js as above. `url` is `null` when Paddle has no payment link for the transaction; hand `id` to `Paddle.Checkout.open({ transactionId })` then.

### Webhooks

Create a [notification destination](https://developer.paddle.com/webhooks/about/notification-destinations) in Paddle that delivers to your webhook route, with these events: `transaction.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.paused`, `subscription.resumed`, `subscription.past_due`, `adjustment.created`, `adjustment.updated`.

The driver checks the `Paddle-Signature` header before it reads anything: HMAC-SHA256 over `<ts>:<raw body>` with the destination's secret, compared in constant time, and a `ts` within `toleranceSeconds` of now. A wrong, missing or stale signature is answered with `401` and changes nothing. While a secret is rotated the header carries several signatures; one of them has to match.

| Paddle | becomes |
|---|---|
| `transaction.completed`, per one-time price in it | `purchase.completed`; the holding is the transaction |
| `transaction.completed` with `origin: subscription_recurring` | `subscription.renewed`, paid until the end of the transaction's billing period |
| `subscription.created` | `subscription.started` |
| any other `subscription.*`, status `active` or `trialing` | `subscription.changed` |
| …with a cancel or pause scheduled | `subscription.canceled`, access until the scheduled date |
| …status `canceled` or `paused` | `subscription.canceled`, access ended when it was canceled or paused |
| …status `past_due` | `payment.failed` |
| `adjustment.created` / `adjustment.updated`: `refund` or `chargeback`, `approved`, `full` | `payment.refunded` |
| everything else | nothing, answered with `200` |

A subscription event is read by the state of the subscription in it, not by its name: Paddle sends `subscription.updated` after a cancel as well, and it must not bring the subscription back. Where Paddle reports one change with two events, the second one is `unchanged` and your side effects run once.

What to know:

- **One price per checkout.** That is what `billing.checkout()` creates. Of a subscription with several items, the first one says which product it is. A transaction with several one-time prices becomes a purchase per price, and a refund of it finds only the first.
- **Refunds name no price and no user.** They are matched through the transaction or subscription they belong to. A refund for a purchase billing never saw is answered with `409` until Paddle stops trying.
- **A refunded subscription payment** marks the subscription `refunded` until its next renewal is paid; Paddle does not cancel it by itself. Partial, pending and rejected refunds and a chargeback that was reversed change nothing.
- **A pause** has no status of its own: the subscription is `canceled` with `accessEndsAt` at the pause, and `active` again when it resumes.
- **Retries.** Paddle delivers again on anything but a `200`: 60 times within three days live, 3 times within 15 minutes in the sandbox. It expects the answer within five seconds; `handleWebhook` makes a handful of store calls and none to Paddle.
- **The manage link** is a session of Paddle's customer portal for the user's customer. It is temporary, so ask for it per request and do not store it. It is `null` before the first event of a user; `returnUrl` has no counterpart in Paddle.
- **Coming from the console driver.** Holdings the console driver wrote stay in the store. Start Paddle on a store or `prefix` of its own.

### Trying it in the sandbox

The tests of the driver run against Paddle's documented notifications without a network. To see it work against Paddle itself:

1. In the Paddle **sandbox**, create a product with a one-time price and one with a recurring price, and put the two `pri_…` ids into `products`.
2. Create an API key with the two permissions above and a client-side token. Set `PADDLE_API_KEY`, `PADDLE_SANDBOX=true`, and the token on the checkout page.
3. Set the default payment link (Checkout, Checkout configuration) to the checkout page above, or pass `checkoutUrl`. Outside the sandbox the page's website has to be approved by Paddle first.
4. Create a notification destination for the URL of your webhook route with the events above, and set its secret key as `PADDLE_WEBHOOK_SECRET`. Paddle has to reach the route, so use a deployed preview of the app. Paddle's [webhook simulator](https://developer.paddle.com/webhooks/simulator) sends single events to it without a checkout.
5. Start a checkout for each product and pay with one of [Paddle's test cards](https://developer.paddle.com/sdks/sandbox#test-cards). `billing.account(userId)` then shows an `active` holding for each, and the destination's log shows every delivery answered with `200`.
6. Open `billing.manageUrl(userId)` and cancel the subscription: the holding becomes `canceled` with `accessEndsAt` at the end of the period.
7. Refund the one-time transaction in full in the dashboard: the holding becomes `refunded`.
8. Send a request with a changed body to the webhook route (`curl -X POST` with any `Paddle-Signature`): the answer is `401` and nothing changes.

| Value | | Goes to |
|---|---|---|
| `PADDLE_API_KEY` | secret | `paddle.apiKey` |
| `PADDLE_WEBHOOK_SECRET` | secret | `paddle.webhookSecret` |
| `PADDLE_SANDBOX` | `true` everywhere but production | `paddle.sandbox` |
| client-side token | public | `Paddle.Initialize` on the checkout page |

## Your own driver

A driver is three methods:

```ts
import { BillingWebhookError } from '@loewen-digital/fullstack/billing'
import type { BillingDriver } from '@loewen-digital/fullstack/billing'

declare function verify(signature: string | null, body: string): Promise<boolean>

const driver: BillingDriver = {
  name: 'my-provider',

  async createCheckout({ userId, providerId, customerId, successUrl }) {
    // Create the checkout at the provider and put `userId` into its custom data.
    return { id: 'chk_1', url: 'https://pay.example/chk_1' }
  },

  async parseWebhook(request) {
    const body = await request.text() // the raw body, before any parsing
    if (!(await verify(request.headers.get('X-Signature'), body))) {
      throw new BillingWebhookError('invalid signature', 401)
    }
    const payload = JSON.parse(body)
    return {
      events: [
        {
          type: 'purchase.completed',
          id: payload.event_id,
          occurredAt: new Date(payload.occurred_at),
          userId: payload.custom_data?.user_id,
          customerId: payload.customer_id,
          providerId: payload.price_id,
          holdingId: payload.transaction_id,
        },
      ],
    }
  },

  async createManageUrl({ customerId }) {
    return customerId ? `https://pay.example/portal/${customerId}` : null
  },
}
```

- Throw `BillingWebhookError(message, status)` for a request that is not a valid delivery; nothing is changed and the status is the answer. Anything else a driver throws is answered with `500`.
- `userId` and `customerId` are optional on an event. An event without `userId` is matched through its `holdingId`, then through its `customerId`, which is how a refund that only names its transaction finds its user.
- `providerId` is optional too, for an event that does not say what was sold. Billing takes the product of the holding then, and answers `409` while the holding is not there.
- Report `subscription.changed` only for a subscription the provider considers running: it clears a cancel and a failed payment.
- `holdingId` is the provider's id of the purchase or the subscription and has to be the same on every event about it.
- Never log the request, its headers or the provider's secrets.

## Testing

`createFakeBillingDriver` from [testing](/testing/fakes) builds the webhook request for any event, so a test covers "paid", "canceled" and "refunded" without a provider:

```ts
import { expect } from 'vitest'
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'
import { createFakeBillingDriver } from '@loewen-digital/fullstack/testing'

async function assertsBilling() {
  const fakeBilling = createFakeBillingDriver()
  const billing = createBilling({
    driver: fakeBilling,
    store: createMemoryBillingStore(),
    products: { pro: { type: 'subscription', providerId: 'pri_pro' } },
  })

  await billing.checkout({ userId: 'u1', product: 'pro' })
  expect(fakeBilling.checkouts[0]?.providerId).toBe('pri_pro')

  const paidUntil = new Date('2026-11-09T00:00:00Z')
  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro', currentPeriodEnd: paidUntil }),
  )
  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'subscription.canceled', userId: 'u1', providerId: 'pri_pro', accessEndsAt: paidUntil }),
  )

  const { holdings } = await billing.account('u1')
  expect(holdings[0]).toMatchObject({ status: 'canceled', accessEndsAt: paidUntil })

  const rejected = await billing.handleWebhook(fakeBilling.invalidWebhook())
  expect(rejected.response.status).toBe(401)
}
```

## What it does not do

Tax, invoices, coupons and seats are the provider's. The module does not decide what a purchase unlocks, counts no usage and has no UI. Partial refunds have no event of their own: a driver reports `payment.refunded` when the purchase is gone, and nothing for a partial one.
