---
title: Billing
description: Checkouts for one-time purchases and subscriptions, and what each user holds, from verified provider events
---

# Billing

`createBilling` takes money through a payment provider and keeps what each user has paid for. The app starts a checkout for a user id and a product, hands the provider's webhooks to the module, and asks what a user holds without calling the provider. The provider sits behind a driver, the state behind a store, and a user is a plain string id: the module needs no other fullstack module, so it works next to `auth` as well as next to an auth of your own.

Nothing is ever granted because a browser came back from a checkout. State changes only through an event the driver verified.

The `console` driver ships with the module and takes no money; it is for building the flow before a provider account exists. A driver for a real provider is a driver of its own, see [Your own driver](#your-own-driver).

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
| `driver` | required | `'console'`, or a `BillingDriver` |
| `products` | required | What the app sells: `{ [key]: { type, providerId } }`. Two products with the same `providerId` throw |
| `store` | required | Where accounts are kept. There is no default: purchases in the memory of one process are lost with it |
| `console` | optional | Options of the console driver: `webhookUrl` (default `/billing/webhook`), `periodDays` (default 30) |
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

`checkout({ userId, product, email?, successUrl?, cancelUrl? })` returns `{ id, url }`: the provider's id of the checkout and the page to send the browser to. `url` is `null` for a provider whose checkout only opens through its client script; the script takes `id`. The user's provider customer goes along when billing already knows it, so a returning buyer is not created twice.

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
| `response` | What to answer with. `200` when everything was handled; the driver's status (`400`, `401`, `405`) when verification failed; `409` when an event has no user yet; `500` when the store or the driver failed |
| `events` | The events that changed state, matched to your user id and product key. Each event shows up here once, however often it is delivered |
| `skipped` | The events that changed nothing, as `{ reason, event }` |

A non-2xx answer makes the provider deliver again later, which is what `409` and `500` are for.

| `reason` | |
|---|---|
| `duplicate` | The event was applied before |
| `stale` | A newer event of the same purchase or subscription was applied before; the state stays as it is |
| `unmatched` | The event names no user, and neither its purchase nor its customer is linked to one yet. Answered with `409`: the event that names the user may still be on its way |
| `unknown-product` | The provider's product id is not in `products` |

## Events

| `type` | Extra field | What it does to the holding |
|---|---|---|
| `purchase.completed` | | A one-time purchase, `active` |
| `subscription.started` | `currentPeriodEnd` | A subscription, `active` |
| `subscription.renewed` | `currentPeriodEnd` | `active` again, also after a failed payment or a cancel |
| `subscription.changed` | `currentPeriodEnd` | Another product or period. Takes back a cancel; a failed payment stays failed |
| `subscription.canceled` | `accessEndsAt` | `canceled`; the user has paid until `accessEndsAt` |
| `payment.failed` | | An `active` subscription becomes `past_due`. Nothing else changes |
| `payment.refunded` | | `refunded`, with `accessEndsAt` set to the time of the refund |

Every event carries `id` (the provider's), `occurredAt`, `userId`, `product` and `holdingId`.

**Exactly once.** An event is applied once per `id`, also when the provider delivers it twice in the same instant. The ids of the applied events are kept in the same record as the user's holdings and written with them in one step, so there is no moment in which an event counts as handled while its purchase is missing.

**Order.** Deliveries arrive in any order. An event older than the newest one applied to its holding is `stale` and changes nothing: a renewal that arrives after the cancel that followed it does not bring the subscription back. An event for a holding nobody has seen creates it, so a refund that overtakes its purchase is there when the purchase arrives late.

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
