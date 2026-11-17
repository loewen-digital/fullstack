---
title: Billing
description: Checkouts for one-time purchases and subscriptions through Paddle, purchases made in an iOS app through the App Store, or a driver of your own, several providers in one account, what each user holds from verified provider events, and what that lets them use
---

# Billing

`createBilling` takes money through a payment provider and keeps what each user has paid for. The app starts a checkout for a user id and a product, hands the provider's webhooks to the module, and asks what a user holds without calling the provider. The provider sits behind a driver, the state behind a store, and a user is a plain string id: the module needs no other fullstack module, so it works next to `auth` as well as next to an auth of your own.

Nothing is ever granted because a browser came back from a checkout, or because a client says it bought something. State changes only through what a driver verified: a provider's webhook, or the proof of a purchase made on the device.

Three drivers ship with the module. `console` takes no money; it is for building the flow before a provider account exists. `paddle` sells through Paddle Billing, see [The Paddle driver](#the-paddle-driver). Going from one to the other is a change of config and secrets, plus the page that opens Paddle's checkout. `createAppStoreDriver` takes what a web app shipped as an iOS app sells through Apple's in-app purchase, see [The App Store driver](#the-app-store-driver). Any other provider is a [driver of your own](#your-own-driver).

An app that sells in more than one place, on the web through Paddle and inside its store app through the store, puts the drivers side by side and keeps one account per user: see [Several providers](#several-providers) and [Purchases made on the device](#purchases-made-on-the-device).

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
    unlock: { type: 'one-time', providerId: 'pri_unlock', features: ['themes'] },
    pro: {
      type: 'subscription',
      providerId: 'pri_pro',
      features: ['themes', 'export'],
      limits: { feeds: 500 },
    },
  },
  entitlements: { default: { limits: { feeds: 5 } } },
})
```

`features` and `limits` say what a product lets its holder use; they are optional and belong to [Entitlements](#entitlements).

| Option | | |
|---|---|---|
| `driver` | this or `drivers` | One provider: `'console'`, `'paddle'`, or a `BillingDriver` |
| `drivers` | this or `driver` | Several providers, each under a name of your choice: `{ paddle: 'paddle', app: createAppStoreDriver(…) }`. See [Several providers](#several-providers) |
| `products` | required | What the app sells: `{ [key]: { type, providerId, features?, limits? } }`. With `drivers`, `providerId` is the id at each provider: `{ paddle: 'pri_…', app: 'com.example.pro' }`. Two products with the same id at one provider throw |
| `store` | required | Where accounts are kept. There is no default: purchases in the memory of one process are lost with it |
| `console` | optional | Options of the console driver: `webhookUrl` (default `/billing/webhook`), `periodDays` (default 30) |
| `paddle` | with `driver: 'paddle'` | Options of the Paddle driver: `apiKey`, `webhookSecret`, `sandbox`, `checkoutUrl`, `toleranceSeconds` |
| `entitlements` | optional | `default`: the features and limits every user has; `pastDueGraceDays`: how long a failed payment keeps granting. See [Entitlements](#entitlements) |
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

`checkout({ userId, product, provider?, email?, successUrl?, cancelUrl? })` returns `{ id, url }`: the provider's id of the checkout and the page to send the browser to. `url` is `null` when the provider has no page to send the browser to; its client script takes `id` then. The user's provider customer goes along when billing already knows it, so a returning buyer is not created twice.

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

Every event carries `id` (the provider's), `provider` (the name of the provider it came from), `occurredAt`, `userId`, `product` and `holdingId`.

**Exactly once.** An event is applied once per provider and `id`, also when the provider delivers it twice in the same instant. The ids of the applied events are kept in the same record as the user's holdings and written with them in one step, so there is no moment in which an event counts as handled while its purchase is missing.

**Order.** Deliveries arrive in any order. An event older than the newest one applied to its holding is `stale` and changes nothing: a renewal that arrives after the cancel that followed it does not bring the subscription back. An event for a holding nobody has seen creates it, so a refund that overtakes its purchase is there when the purchase arrives late. The exception is an event without a product (Paddle's refunds name only their transaction): it waits for its purchase and is answered with `409` until then.

**Your own side effects.** `events` is the place for them (a mail, a credit to a balance), but the module cannot make your code exactly-once: if your handler fails after the state was stored and you answer with an error, the redelivery reports the event under `skipped` as `duplicate`. Make a side effect that must not be lost idempotent on `event.provider` and `event.id` together (two providers may use the same id) and run it for `duplicate` entries too.

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

`billing.account(userId)` is one read from the store and no call to the provider. It answers `{ userId, customers, holdings, grants }`; `customers` is the customer the user is at each provider, by provider. A user billing has never seen has no holdings, no grants and no customers.

| Field of a holding | |
|---|---|
| `provider` | Who sold it: the name of the provider. With one `driver` that is the driver's name (`console`, `paddle`), with `drivers` the name you gave it |
| `id` | The provider's id of the purchase or subscription; unique per provider |
| `product` | The key in `products` |
| `type` | `'one-time'` or `'subscription'` |
| `status` | `active`, `past_due` (the last payment failed and the provider has not given up), `canceled`, `refunded` |
| `startedAt` | The time of the first event |
| `currentPeriodEnd` | Subscriptions: the end of the paid period, or `null` |
| `accessEndsAt` | Set by a cancel and by a refund, otherwise `null` |
| `pastDueSince` | The time of the first failed payment while the holding is `past_due`, otherwise `null` |
| `updatedAt` | The time of the newest event applied |

Holdings are never removed; a canceled or refunded one stays with its status. Holdings are the record of what happened. What they let the user do (that `canceled` still counts until `accessEndsAt`, how long `past_due` does) is answered by [entitlements](#entitlements), so no route has to work it out.

`billing.manageUrl(userId, { returnUrl?, provider? })` returns the link where the user manages or cancels what they bought, or `null` when the provider has nothing to manage for them yet. With several providers it is the link of one of them: pass the `provider` of the holding.

## Entitlements

Routes should not read holdings and decide for themselves what a canceled subscription or a failed payment means. Declare on each product what it gives, and ask one question:

```ts
// src/routes/export/+server.ts
import { error } from '@sveltejs/kit'
import { billing } from '#lib/server/billing.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.authSession) error(401)

  const entitlements = await billing.entitlements(String(locals.authSession.userId))
  if (!entitlements.has('export')) error(402, 'The export is part of Pro')
  const feeds = entitlements.limit('feeds') // 5 without a plan, 500 with Pro

  return Response.json({ feeds })
}
```

A product declares `features` (names it unlocks) and `limits` (numbers it sets); `entitlements.default` is what every user has, also one who bought nothing. `billing.entitlements(userId)` is one read from the store and no call to the provider. It answers:

| | |
|---|---|
| `has(feature)` | Whether the user has a feature. A name that is not in the config is a type error |
| `limit(name)` | A limit for the user; `0` when nothing sets it for them |
| `features`, `limits` | The same as plain data, for a `load` function: `has` and `limit` are functions and do not serialize |
| `products` | The keys of the products that grant right now, paid or given by hand |

Features add up over the default and everything the user holds. Of a limit the highest value counts, whatever sets it; use `Infinity` for no limit. The rules that turn a holding into an answer live here and nowhere else:

| The user holds | Grants |
|---|---|
| a subscription that is `active` | yes |
| a one-time purchase that is `active` | yes, for good |
| a `canceled` subscription | until `accessEndsAt`, the end of what was paid for; not from that moment on |
| a `past_due` subscription | by default for as long as the provider keeps trying, which ends when it cancels the subscription; with `pastDueGraceDays` for that many days after the first failed payment, `0` for not at all |
| anything `refunded` | no |
| a product given by hand | until its end date, or for good |

`entitlements(userId, { now })` answers for another moment than the present, which is how a test checks an end date.

### Giving a product by hand

```ts
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'

const gifts = createBilling({
  driver: 'console',
  store: createMemoryBillingStore(),
  products: { pro: { type: 'subscription', providerId: 'pri_pro', features: ['export'] } },
})

async function givesByHand() {
  await gifts.grant('tester-1', 'pro') // for good
  await gifts.grant('friend-2', 'pro', { until: new Date('2027-01-01') }) // a gift with an end
  await gifts.revoke('tester-1', 'pro') // true; false when there was no grant
}
```

A grant needs no provider and no purchase. It lives next to the holdings in the user's account, and no billing event changes it: a refund of the same product ends what was paid for, not what was given. Granting a product again replaces the earlier grant and its end date. `revoke` takes back a grant and nothing else; what a user paid for ends through the provider. `billing.account(userId).grants` lists them.

### On the request

The SvelteKit and the fetch adapter resolve entitlements for the signed-in user when billing is handed to them:

```ts
// src/hooks.server.ts
import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import type { AuthInstance } from '@loewen-digital/fullstack/auth'
import { billing } from '#lib/server/billing.js'

declare const auth: AuthInstance // your auth instance

export const handle = createHandle({ auth, billing })
```

```ts
// src/routes/themes/+page.server.ts
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const entitlements = await locals.entitlements?.()
  if (!entitlements?.has('themes')) error(402)
  return { limits: entitlements.limits }
}
```

`locals.entitlements()` is a function on purpose: the store is read when a route asks, once per request, and not at all for the routes that never ask. It answers `null` without a signed-in user. The user id is `locals.authSession.userId`; for an auth of your own, or when the plan belongs to something else than the user (a site, a team), pass `entitlementsFor: (event) => id` to `createHandle`. With the fetch adapter the same function is on the result of `sessionOf`: `const { session, entitlements } = await adapter.sessionOf(request)`.

A user id is whatever your app bills: billing never looks at it. A CMS with a plan per site starts checkouts with the site's id and asks `billing.entitlements(siteId)`.

## Several providers

One `driver` is one provider. An app that sells in several places names them in `drivers` instead, each under a name of your choice, and says for each product what it is called where:

```ts
import { createAppStoreDriver, createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'

const shop = createBilling({
  drivers: {
    paddle: 'paddle',
    app: createAppStoreDriver({ bundleId: 'com.example.app', environment: 'production' }),
  },
  paddle: {
    apiKey: process.env.PADDLE_API_KEY!,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
  },
  store: createMemoryBillingStore(), // your flatdb store, as in Setup
  products: {
    pro: {
      type: 'subscription',
      providerId: { paddle: 'pri_01j…', app: 'com.example.pro' },
      features: ['export'],
    },
    credits: { type: 'one-time', providerId: { app: 'com.example.credits' } }, // only in the app
  },
})

async function sellsOnTheWeb(userId: string) {
  return shop.checkout({ provider: 'paddle', userId, product: 'pro' })
}

// One webhook route per provider; each says whose request it got.
async function takesPaddleWebhooks(request: Request) {
  const { response } = await shop.handleWebhook(request, { provider: 'paddle' })
  return response
}

async function showsWhatAUserHolds(userId: string) {
  const { holdings } = await shop.account(userId)
  return Promise.all(
    holdings.map(async (holding) => ({
      product: holding.product,
      soldBy: holding.provider, // 'paddle' or 'app'
      status: holding.status,
      manageUrl: await shop.manageUrl(userId, { provider: holding.provider }),
    })),
  )
}
```

- **Every call names its provider**: `checkout`, `handleWebhook`, `verifyPurchase` and `manageUrl` take `provider`. With several drivers a call without one throws a `BillingError`; `handleWebhook`, which never throws, answers `500` and reports it to `onError`. With one `driver` nobody has to name it. A name that is not in `drivers` is a type error.
- **A product has an id at each provider that sells it.** `checkout` for a product at a provider that has no id for it throws. `providerId: {}` is a product nobody sells, one that is only [given by hand](#giving-a-product-by-hand).
- **One account.** The holdings of every provider are in `billing.account(userId).holdings`, each with the `provider` that sold it, and `billing.entitlements(userId)` answers from all of them: no route has to know where a user paid.
- **Bought twice is two holdings.** A product bought once on the web and once in a store is two holdings, and access lasts while either of them grants. Canceling one cancels that one: the other keeps charging, and only its own provider can end it. When a user who holds a product starts a second purchase of it, tell them before they pay.
- **The manage link belongs to a provider.** Paddle's portal knows nothing of a subscription from a store. Show one link per holding, as above, or one per provider the user holds something from.
- **Ids of two providers never meet.** A purchase id, a customer id and an event id count per provider, in the account and in the store's links.
- **A name is kept with the data.** Holdings and links are stored under the provider's name: lower-case letters, digits, `_` and `-`, starting with a letter. Do not rename a provider that has sold something. Going from `driver: 'paddle'` to `drivers: { paddle: 'paddle', … }` keeps the name, and with it everything stored.
- **The same driver twice** is two providers: a store's sandbox next to its production, each under its own name, never mixed.

## Purchases made on the device

In an app from an app store the purchase does not start on your server. The store's code in the app takes the money and hands the app a proof: a signed transaction, a purchase token. Your server learns of the purchase when the app hands that proof over, together with the signed-in user. For Apple's App Store that is [the App Store driver](#the-app-store-driver); the route is the same for every store:

```ts
// src/routes/billing/purchase/+server.ts
import { error, json } from '@sveltejs/kit'
import { BillingPurchaseError } from '@loewen-digital/fullstack/billing'
import { billing } from '#lib/server/billing.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)

  try {
    const { events } = await billing.verifyPurchase({
      userId: String(locals.authSession.userId), // from the session, never from the body
      proof: await request.json(), // what the device got from the store, as it came
    })
    for (const event of events) {
      // The same side effects as in the webhook route: a mail, a credit to a balance.
      console.log(`user ${event.userId} bought ${event.product} from ${event.provider}`)
    }
  } catch (cause) {
    if (cause instanceof BillingPurchaseError) {
      error(cause.reason === 'other-user' ? 409 : 422, cause.message)
    }
    throw cause // the provider or the store failed: the device tries again
  }
  return json({ done: true }) // the device may close the purchase now
}
```

`verifyPurchase({ userId, proof, provider? })` hands the proof to the driver, which verifies it with the provider, and applies what the proof says:

| | |
|---|---|
| `events` | The events that changed state, as from `handleWebhook` |
| `skipped` | The events that changed nothing, as `{ reason, event }`. `duplicate` is the same proof handed over again; `unknown-product` is a purchase of something `products` does not have at this provider |
| throws `BillingPurchaseError` | `reason: 'invalid'`: the proof is not a valid one of the provider. `reason: 'other-user'`: the purchase belongs to another user. Nothing was changed, and the message never carries the proof |
| throws anything else | The provider could not be asked or the store failed. Nothing is lost: the device hands the proof over again |

- **Only what is verified counts.** The body of the request is a claim. Access comes from a proof the driver verified with the provider, never from what the client says it bought; a body like `{ product: 'pro', paid: true }` is refused as `invalid`.
- **Whose purchase it is.** The user is the one of the session. The first user who hands a purchase over keeps it; anyone who hands the same purchase over later is refused with `other-user`, also when two do it in the same instant. A driver that finds an account in the proof (the token the app set when buying) compares it with the user and refuses a proof that names someone else.
- **All of a proof or none of it.** A proof can tell several things, an upgrade ends one subscription and starts another. When one of them belongs to another user, none is applied.
- **The same path as a webhook.** The events of a proof go where the events of a webhook go: applied once per id, an older one never overwrites a newer state, and a proof and a notification that tell the same thing reach your side effects once, whichever comes first. The device can hand a proof over as often as it likes, on every start of the app.
- **The webhook route stays.** What happens later (a renewal, a cancel, a refund) the provider tells your webhook route, not the device. A notification that arrives before the proof and names no user is answered with `409` until the proof is there.
- **Delivered.** A store may want to hear that a purchase was delivered, and refund one that nobody acknowledged. A driver does that after the events are in the account, and again when the same proof or notification comes in again, see [Your own driver](#your-own-driver).

The console driver plays the device, so the whole flow can be built before a store account exists. Where the app would ask the store, it posts what the store would have answered, `{ providerId, id? }`:

```ts
// in the app's page, in development
async function buysWithoutAStore(providerId: string) {
  await fetch('/billing/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The id is what the device would call the purchase: the same id again is the same purchase.
    body: JSON.stringify({ providerId, id: crypto.randomUUID() }),
  })
}
```

## Stores

A store keeps one account per user and the links from provider ids back to users.

| Store | | Holds its guarantee across |
|---|---|---|
| `createMemoryBillingStore()` | Development and tests. Gone with the process | One process |
| `createFlatdbBillingStore({ adapter, prefix? })` | JSON files on the storage adapter your `flatdb()` runs on | What the adapter coordinates, see below |

The flatdb store takes the adapter, not collections: it writes `billing/accounts/<user>.json` and `billing/refs/<kind>/<provider>:<id>.json` (as a file name: `<provider>~3a<id>.json`) with the adapter's compare-and-swap (`readVersioned` and `writeIf`), which a collection's `update` does not offer. Two events for one user that arrive together are both kept; a writer that lost the race reads again and re-applies its change, twenty times at most, then `handleWebhook` answers `500`. An adapter without the pair is refused when the store is created. It needs `@loewen-digital/flatdb` 0.3 or later.

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
    const current = accounts.get(userId) ?? { userId, customers: {}, holdings: [], grants: [], appliedEvents: [] }
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

`transact` carries the guarantee: read the account, call `change`, store what it returns, and let no concurrent `transact` for the same user slip in between. On SQL that is a transaction with a row lock or a version column. `change` is free of side effects, so call it again on the fresh account after a lost race; when it returns no `account`, write nothing. `link` keeps the first user an id was linked to; that is also what decides whose purchase a proof is, so it must hold when two requests link the same id at once. The ids `link` and `findUserId` get are a provider's id behind the provider's name, `paddle:ctm_01h…`.

### Coming from 0.7

Up to 0.7 an account did not say who sold what is in it, and ids were stored without a provider. The flatdb store refuses such a file as soon as it holds a purchase (`a holding … names no provider`) rather than guess. To take a store along, rewrite it once. `<provider>` is the name the provider has now, `paddle` for `driver: 'paddle'`:

- In each `accounts/<user>.json`: add `"provider": "<provider>"` to every holding, replace `"customerId": "ctm_…"` by `"customers": { "<provider>": "ctm_…" }`, and put `<provider>:` in front of every entry of `appliedEvents`.
- Under `refs/holding/` and `refs/customer/`: put `<provider>~3a` in front of every file name (`sub_01h….json` becomes `paddle~3asub_01h….json`).

A store that only ever held test purchases is easier left behind: give the store another `prefix`.

## The console driver

`driver: 'console'` completes a checkout without a provider. The checkout URL points at your own webhook route (`console.webhookUrl`); opening it is the payment. The driver reads the checkout from the query string, the module applies `purchase.completed` or `subscription.started` exactly like a provider's event, and the browser goes on to `successUrl`. The manage link cancels the user's subscriptions at the end of their period the same way. Reloading either URL delivers the same event id again, which is what a duplicate delivery looks like.

Because the browser arrives with a GET, the webhook route exports `GET` next to `POST`, as above. A redirect only goes to the app's own origin.

It also plays a [purchase made on the device](#purchases-made-on-the-device): `billing.verifyPurchase({ userId, proof: { providerId, id? } })` applies `purchase.completed` or `subscription.started` for the product with that `providerId`. `id` is what the device would call the purchase, 1 to 64 letters, digits, `_` or `-`: the same id again is the same purchase, and one a second user hands over is refused. Without an id every proof is a new purchase.

The driver signs nothing and charges nothing: whoever can open the URL or post a proof has "bought". It is a development tool, never a way to sell.

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
| `checkoutUrl` | optional | The page of your app that opens the checkout, instead of the default payment link set in Paddle. Paddle refuses it until its website is approved, also in the sandbox |
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
| `adjustment.created` / `adjustment.updated`: `refund` or `chargeback`, `approved`, and of type `full` or with every item in full | `payment.refunded` |
| everything else | nothing, answered with `200` |

A subscription event is read by the state of the subscription in it, not by its name: Paddle sends `subscription.updated` after a cancel as well, and it must not bring the subscription back. Where Paddle reports one change with two events, the second one is `unchanged` and your side effects run once.

What to know:

- **One price per checkout.** That is what `billing.checkout()` creates. Of a subscription with several items, the first one says which product it is. A transaction with several one-time prices becomes a purchase per price, and a refund of it finds only the first.
- **Refunds name no price and no user.** They are matched through the transaction or subscription they belong to. A refund for a purchase billing never saw is answered with `409` until Paddle stops trying.
- **A refunded subscription payment** marks the subscription `refunded` until its next renewal is paid; Paddle does not cancel it by itself. A refund counts when it takes everything: the dashboard sends it as `type: partial` with each item in full, and that is read as the whole. A refund of a part of an item or of the tax alone, a pending or rejected one, and a chargeback that was reversed change nothing.
- **A pause** has no status of its own: the subscription is `canceled` with `accessEndsAt` at the pause, and `active` again when it resumes.
- **Retries.** Paddle delivers again on anything but a `200`: 60 times within three days live, 3 times within 15 minutes in the sandbox. It expects the answer within five seconds; `handleWebhook` makes a handful of store calls and none to Paddle.
- **The manage link** is a session of Paddle's customer portal for the user's customer. It is temporary, so ask for it per request and do not store it. It is `null` before the first event of a user; `returnUrl` has no counterpart in Paddle.
- **Coming from the console driver.** Holdings the console driver wrote stay in the store under the provider `console`, and keep granting. Start Paddle on a store or `prefix` of its own.

### Trying it in the sandbox

The tests of the driver run without a network, against Paddle's documented notifications and against a run recorded in the sandbox: a purchase, a subscription, its cancel for the end of the period, the cancel taken back, and a cancel at once. To see it work against Paddle yourself:

1. In the Paddle **sandbox**, create a product with a one-time price and one with a recurring price, and put the two `pri_…` ids into `products`.
2. Create an API key with the two permissions above and a client-side token. Set `PADDLE_API_KEY`, `PADDLE_SANDBOX=true`, and the token on the checkout page.
3. Set the default payment link (Checkout, Checkout configuration) to the checkout page above. The sandbox takes it as it is. A `checkoutUrl` is another matter: without an approved website Paddle answers `transaction_checkout_url_domain_is_not_approved`, in the sandbox too. For a live account Paddle asks for an approved website in both cases.
4. Create a notification destination for the URL of your webhook route with the events above, and set its secret key as `PADDLE_WEBHOOK_SECRET`. Paddle has to reach the route, so use a deployed preview of the app. Paddle's [webhook simulator](https://developer.paddle.com/webhooks/simulator) sends single events to it without a checkout.
5. Start a checkout for each product and pay with one of [Paddle's test cards](https://developer.paddle.com/sdks/sandbox#test-cards). `billing.account(userId)` then shows an `active` holding for each, and the destination's log shows every delivery answered with `200`.
6. Open `billing.manageUrl(userId)` and cancel the subscription: the holding becomes `canceled` with `accessEndsAt` at the end of the period.
7. Refund the one-time transaction in full in the dashboard (Actions on the transaction). The sandbox approves refunds by itself, every ten minutes: the holding becomes `refunded` with the second event, not the first.
8. Send a request with a changed body to the webhook route (`curl -X POST` with any `Paddle-Signature`): the answer is `401` and nothing changes.

| Value | | Goes to |
|---|---|---|
| `PADDLE_API_KEY` | secret | `paddle.apiKey` |
| `PADDLE_WEBHOOK_SECRET` | secret | `paddle.webhookSecret` |
| `PADDLE_SANDBOX` | `true` everywhere but production | `paddle.sandbox` |
| client-side token | public | `Paddle.Initialize` on the checkout page |

## The App Store driver

`createAppStoreDriver` takes what a web app shipped as an iOS app sells through Apple's in-app purchase. The purchase is made on the device, by StoreKit in the app's shell. The driver verifies what the App Store signed and reads it: the signed transaction the app hands over, and the notifications Apple posts to your webhook route. It asks Apple nothing and holds no secret, so it adds no dependency and runs on Node and on Cloudflare Workers, on Web Crypto alone.

```ts
import { appStoreAccountToken, createAppStoreDriver, createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'

const appStore = (environment: 'production' | 'sandbox') =>
  createAppStoreDriver({ bundleId: 'com.example.app', environment })

const appBilling = createBilling({
  // The same driver twice: what Apple's sandbox signed never lands where paid purchases are.
  drivers: { paddle: 'paddle', app: appStore('production'), 'app-sandbox': appStore('sandbox') },
  paddle: {
    apiKey: process.env.PADDLE_API_KEY!,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
  },
  store: createMemoryBillingStore(), // your flatdb store, as in Setup
  products: {
    unlock: {
      type: 'one-time',
      providerId: { paddle: 'pri_01h…', app: 'unlock', 'app-sandbox': 'unlock' }, // Apple's product id
      features: ['themes'],
    },
    pro: {
      type: 'subscription',
      providerId: { paddle: 'pri_01j…', app: 'pro.monthly', 'app-sandbox': 'pro.monthly' },
      features: ['themes', 'export'],
    },
  },
})
```

| Option | | |
|---|---|---|
| `bundleId` | required | The bundle id of the app. What Apple signed for another app is refused |
| `environment` | required | `'production'` or `'sandbox'`. One driver takes one of them and refuses the other, see [Sandbox and production](#sandbox-and-production) |
| `rootCertificates` | optional | The root certificates a signature may lead to, as DER bytes, base64 or PEM. Default: Apple Root CA - G3, which ships with the driver. For tests that sign with a chain of their own |

The driver has no `checkout()`: it throws, because the purchase starts on the device. A product is `type: 'subscription'` for an auto-renewable subscription and `type: 'one-time'` for everything else Apple sells (non-consumable, consumable, non-renewing subscription); a purchase of the other kind than the config says is refused with a `BillingError` that names both.

### The account token

Apple does not know your users. The app says whose purchase it is: it buys with an account token, a UUID, and Apple signs that token into the transaction and into every notification about it. `appStoreAccountToken(userId)` is the token of a user:

```ts
// What the page asks your server for before it lets the app buy.
async function answersTheAccountToken(userId: string) {
  return { appAccountToken: await appStoreAccountToken(userId) } // for the user of the session
}
```

The page hands the token to the app's shell together with the product, and the shell buys with it: `product.purchase(options: [.appAccountToken(token)])` in StoreKit 2.

- **How it is derived.** A version 5 UUID of the user id in the namespace `1f6dc268-0ded-4a8f-85f4-e05e552c9048`. The same user id gives the same token every time, in any language that has UUID v5, and the token does not give the id away.
- **A purchase is refused without it.** A transaction that carries no account token is `invalid`; one with the token of another user is `other-user`. So nobody gets a purchase by sending a transaction that is not theirs, also not one they got hold of before its owner handed it over.
- **It is the customer.** The token is stored as the user's customer at this provider, `account.customers`. Once a user has handed one purchase over, a notification about any later purchase of theirs finds them through it.
- **Purchases outside the app** carry no token: an offer code redeemed in the App Store, a purchase a family member shares. They are not taken.

### Handing a purchase over

After a purchase StoreKit gives the shell a transaction, and `jwsRepresentation` of it is the proof: one string, signed by the App Store. The shell hands it to the page, the page posts it:

```ts
// src/routes/billing/app-store/+server.ts
import { error, json } from '@sveltejs/kit'
import { BillingPurchaseError } from '@loewen-digital/fullstack/billing'
import { billing } from '#lib/server/billing.js'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authSession) error(401)
  const body = (await request.json()) as { transaction?: unknown; sandbox?: unknown }

  try {
    const { events } = await billing.verifyPurchase({
      // Which provider is a hint from the app, and nothing more: a transaction of the other
      // environment is refused by the driver, whatever the body says.
      provider: body.sandbox === true ? 'app-sandbox' : 'app',
      userId: String(locals.authSession.userId),
      proof: body.transaction,
    })
    return json({ done: true, changed: events.length }) // the shell may `finish()` the transaction
  } catch (cause) {
    if (cause instanceof BillingPurchaseError) {
      error(cause.reason === 'other-user' ? 409 : 422, cause.message)
    }
    throw cause
  }
}
```

The driver checks, in this order: the signature and its certificate chain up to Apple's root, the bundle id, the environment, the account token. Then it reads the transaction:

| The transaction | becomes |
|---|---|
| a non-consumable, a consumable, a non-renewing subscription | `purchase.completed`; the holding is the transaction |
| an auto-renewable subscription the customer bought | `subscription.started`, paid until `expiresDate`; the holding is the first transaction of the subscription, for every renewal and every product of its group |
| …that Apple renewed (`transactionReason: RENEWAL`) | `subscription.renewed` |
| …with a `revocationDate` | the same, and `payment.refunded` after it |
| a subscription period that is over, a transaction an upgrade replaced | nothing: `events` is empty |

- **Hand it over when it is made, and again on every start.** `Transaction.unfinished` and `Transaction.currentEntitlements` are what to post. A purchase that is already in the account is skipped as `duplicate`.
- **Finish after the answer.** Let the shell call `finish()` on the transaction once the route answered: StoreKit keeps an unfinished transaction and hands it out again, which is the retry when your server was not reachable.
- **A period that is over starts nothing.** An old transaction would otherwise start a subscription that nothing ends. The subscription a user holds today is in the transaction of its current period.
- **A consumable is a holding of its own** per purchase, and it stays `active`: sell consumables as products without features and credit them from the event, as in [usage](/modules/usage). The `quantity` of a purchase is not read; sell a pack as a product of its own.

### Notifications

What happens after the purchase (a renewal, a cancel, a failed payment, a refund) Apple tells your server, not the device. In App Store Connect, under App Information, App Store Server Notifications, set the Production Server URL and the Sandbox Server URL to two routes of your app, both as **Version 2**:

```ts
// The route behind the Production Server URL; the one of the sandbox names 'app-sandbox'.
async function takesAppStoreNotifications(request: Request) {
  const { response, events } = await appBilling.handleWebhook(request, { provider: 'app' })
  for (const event of events) {
    console.log(`${event.type} for user ${event.userId}: ${event.product}`)
  }
  return response
}
```

The driver verifies the notification like a transaction, and the transaction inside it once more on its own: signature, chain, bundle id, environment. What does not verify is answered with `401`, a notification for another app or from the other environment with `400`; nothing is changed.

| Apple | becomes |
|---|---|
| any notification below, for a transaction billing has not seen | first what the transaction says, as in the table above |
| `ONE_TIME_CHARGE`, `SUBSCRIBED`, `DID_RENEW` | that alone |
| `DID_CHANGE_RENEWAL_PREF` or `OFFER_REDEEMED` with `UPGRADE` | `subscription.changed` to the new product; a downgrade changes nothing until it renews |
| `DID_CHANGE_RENEWAL_STATUS` with `AUTO_RENEW_DISABLED` | `subscription.canceled`, access until `expiresDate` |
| …with `AUTO_RENEW_ENABLED`, while the subscription runs | `subscription.changed`: the cancel is taken back |
| `DID_FAIL_TO_RENEW` with `GRACE_PERIOD` | `payment.failed`: `past_due`, access stays while Apple tries |
| `DID_FAIL_TO_RENEW` without | `payment.failed`, then `subscription.canceled` with access until `expiresDate` |
| `GRACE_PERIOD_EXPIRED` | `subscription.canceled`, access ended |
| `EXPIRED` | `subscription.canceled`, access ended at `expiresDate` |
| `REFUND`, `REVOKE` | `payment.refunded`, from the `revocationDate` of the transaction |
| `REFUND_REVERSED` | `purchase.completed`, or `subscription.renewed` for a period that still runs |
| everything else (`TEST`, `PRICE_INCREASE`, `CONSUMPTION_REQUEST`, …) | nothing, answered with `200` |

What to know:

- **Without notifications nothing ever ends.** A purchase is in the account as soon as the app hands it over, with or without notifications. A subscription ends only when Apple says so, here. An app that takes purchases and never set the two URLs gives every subscription away for good, and nothing looks broken. See a `subscription.renewed` arrive in the sandbox before you sell.
- **A proof and a notification are one event.** Both tell a purchase under the id of its transaction, so it reaches your side effects once, whichever arrives first. What only a notification tells (a cancel, an expiry) has the id of the notification, which Apple keeps when it delivers again.
- **A notification before the proof.** One that names a purchase nobody handed over, by a user who has handed none over yet, is answered with `409`. Apple delivers again after 1, 12, 24, 48 and 72 hours, in production; the sandbox tries once.
- **A purchase that is handed over very late can be stale.** When Apple has stopped trying, what it told is lost. A transaction the app hands over after that still starts its purchase, also one Apple has refunded in the meantime. The driver does not ask Apple; an app that needs to be sure asks the App Store Server API with a key of its own before it calls `verifyPurchase`.
- **The grace period is Apple's.** Set a Billing Grace Period in App Store Connect and a failed renewal keeps its access while Apple tries, as `past_due`; `entitlements.pastDueGraceDays` can shorten that, not extend it. Without one Apple's word is to stop, and the subscription is `canceled` with the period it was paid for. A renewal that comes after all makes it `active` again.
- **An upgrade** is `subscription.changed` when the notification brings it, and `subscription.started` when the app hands the new transaction over first: a transaction does not say that it replaced another. The state is the same.
- **A refund** counts when it takes the purchase away, however large it is. For a subscription that is a refund of the period that was running; one of a period that had ended leaves the subscription as it is.
- **The manage link** is `https://apps.apple.com/account/subscriptions`, Apple's page for subscriptions, for a user who holds one; `null` otherwise. A one-time purchase has nothing to manage.
- **What is checked on a signature.** The algorithm is ES256 and nothing else; the header carries three certificates; the second is issued by a root of the config and may issue certificates; the first is issued by the second; both carry the extensions Apple marks its App Store certificates with; all three were valid when the data was signed. That is what Apple's own server library checks. The driver asks no revocation service, and the root that ships with it runs out in 2039.
- **Not taken:** purchases made in Xcode with a StoreKit configuration file, which Xcode signs, not Apple; receipts of the original StoreKit; version 1 notifications; Family Sharing; a renewal date you extend through Apple's API.

### Sandbox and production

Apple runs two environments, and everything it signs says which one it is from. A purchase in the sandbox costs nothing, so a driver takes one environment and refuses the other: configure the driver twice, as above, and paid and free purchases are two providers that never mix. Every holding says which one sold it, in `holding.provider`.

- **Production has to take sandbox purchases from someone.** While an app is in review, Apple buys in the sandbox, with the build you submitted, which talks to your production server. A server that refuses every sandbox purchase fails the review.
- **Not from everyone.** Whoever has a TestFlight build of the app buys in the sandbox, for free. In production, let the sandbox provider in for the accounts you name, your testers and the account you give the review, and answer everyone else with `403` before `verifyPurchase` is called.
- **Two webhook URLs.** Apple posts sandbox notifications to the Sandbox Server URL. A notification that reaches the route of the other environment is answered with `400`.

### Trying it in the sandbox

The tests of the driver run without a network: on payloads in the shape of Apple's reference, signed by a certificate chain the test makes for the run, and on Apple's real certificates for the check of the chain. Nothing was recorded from a sandbox account yet. To see it work against Apple yourself:

1. In App Store Connect, create a non-consumable and an auto-renewable subscription for the app, and put their product ids into `products`, under the sandbox provider.
2. Set `bundleId` to the app's bundle id and deploy a preview of your app: Apple has to reach it.
3. Under App Information, App Store Server Notifications, set the Sandbox Server URL to the notification route of the preview, as Version 2.
4. Create a Sandbox Apple Account under Users and Access, Sandbox.
5. Install a development-signed build or a TestFlight build of the app, and sign in with the sandbox account when the purchase sheet asks (or under Settings, Developer, Sandbox Apple Account). A purchase made with a StoreKit configuration file in Xcode is signed by Xcode and refused.
6. Buy both products. The purchase route answers, and `billing.account(userId)` shows an `active` holding for each, sold by `app-sandbox`. Post the same transaction again: nothing changes.
7. Wait. The sandbox renews a subscription within minutes instead of months, up to twelve times, and then lets it expire: every renewal arrives as `subscription.renewed`, and the end as `subscription.canceled`. When nothing arrives, the URL of step 3 is wrong.
8. Buy the subscription again and cancel it in the sandbox account's settings: the holding becomes `canceled` with `accessEndsAt` at the end of the period.
9. Sign in as a second user of your app and post the transaction of the first: the answer is `409`.
10. Post a transaction with one character changed, and a notification body with one character changed: `422` and `401`, and nothing changes.

| Value | | Goes to |
|---|---|---|
| bundle id | public | `bundleId` |
| the environment | `'production'` or `'sandbox'` | `environment`, one driver each |
| product ids | public | `providerId` of each product, per provider |
| Production Server URL, Sandbox Server URL | set in App Store Connect, Version 2 | the two notification routes |

There is no secret among them: the driver verifies with Apple's public root and signs nothing.

## Your own driver

A driver is three methods, and a fourth when purchases start on the device:

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

A provider whose purchases start on the device adds `verifyPurchase`:

```ts
import { BillingPurchaseError } from '@loewen-digital/fullstack/billing'
import type { DriverPurchaseInput, DriverPurchaseResult } from '@loewen-digital/fullstack/billing'

interface StorePurchase {
  id: string
  productId: string
  purchasedAt: string
  accountToken?: string
}
declare function verifyWithTheStore(proof: unknown): Promise<StorePurchase | null>
declare function acknowledge(purchaseId: string): Promise<void>
declare function accountTokenOf(userId: string): string

async function verifyPurchase({ userId, proof }: DriverPurchaseInput): Promise<DriverPurchaseResult> {
  const purchase = await verifyWithTheStore(proof) // the signature, the app, the environment
  if (!purchase) throw new BillingPurchaseError('the proof does not verify', 'invalid')
  if (purchase.accountToken && purchase.accountToken !== accountTokenOf(userId)) {
    throw new BillingPurchaseError('this purchase belongs to another user', 'other-user')
  }
  return {
    events: [
      {
        type: 'purchase.completed',
        id: `purchase:${purchase.id}`, // from the purchase, so a notification of it has the same id
        occurredAt: new Date(purchase.purchasedAt),
        providerId: purchase.productId,
        holdingId: purchase.id,
      },
    ],
    // Once the events are in the account: tell the store the purchase was delivered.
    settle: () => acknowledge(purchase.id),
  }
}
```

- Throw `BillingWebhookError(message, status)` for a request that is not a valid delivery; nothing is changed and the status is the answer. Anything else a driver throws is answered with `500`.
- `userId` and `customerId` are optional on an event. An event without `userId` is matched through its `holdingId`, then through its `customerId`, which is how a refund that only names its transaction finds its user.
- `providerId` is optional too, for an event that does not say what was sold. Billing takes the product of the holding then, and answers `409` while the holding is not there.
- Report `subscription.changed` only for a subscription the provider considers running: it clears a cancel and a failed payment.
- `holdingId` is the provider's id of the purchase or the subscription and has to be the same on every event about it.
- `createManageUrl` gets the user's customer and holdings at this provider only, and this provider's ids of the products.
- `verifyPurchase` gets the proof as the app received it, the signed-in user, and `products`: what the config sells through this provider, by the provider's id. Throw `BillingPurchaseError(message, 'invalid')` for a proof that is not a valid one of the provider, and `'other-user'` when it names another user; anything else a driver throws reaches the caller of `billing.verifyPurchase` as it is. Leave `userId` off the events: they are applied for the user who handed the proof over, and billing refuses a purchase that is linked to someone else.
- **An event has one id, however the driver learned of it.** Build the id from what happened (the transaction, the subscription and its period, the refund), not from the delivery, so a proof and a notification that tell the same thing are one event. Where that is not possible the second one still changes nothing, but it is skipped as `unchanged` instead of `duplicate`.
- `settle`, on the result of `verifyPurchase` and of `parseWebhook`, is called once every event of it is in its user's account, applied now or before: the place to acknowledge or consume a purchase at the store. It is not called while an event waits for its user (`unmatched`) or names a product the config does not have. It is called again when the same proof or delivery comes in again, so it has to bear being repeated; when it throws, the delivery is answered with `500` and `billing.verifyPurchase` throws, and the next attempt settles.
- Keep ids short and plain: stores use them as keys, and the flatdb store as file names of at most 200 bytes, where every character outside `a-z`, `0-9`, `_` and `-` counts three. Hash an id that is long, as a store's purchase token is.
- Never log the request, its headers, a proof or the provider's secrets.

## Testing

`createFakeBillingDriver` from [testing](/testing/fakes) builds the webhook request for any event, so a test covers "paid", "not paid", "canceled" and "refunded" without a provider:

```ts
import { expect } from 'vitest'
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'
import { createFakeBillingDriver } from '@loewen-digital/fullstack/testing'

async function assertsBilling() {
  const fakeBilling = createFakeBillingDriver()
  const billing = createBilling({
    driver: fakeBilling,
    store: createMemoryBillingStore(),
    products: { pro: { type: 'subscription', providerId: 'pri_pro', features: ['export'] } },
  })

  await billing.checkout({ userId: 'u1', product: 'pro' })
  expect(fakeBilling.checkouts[0]?.providerId).toBe('pri_pro')
  expect((await billing.entitlements('u1')).has('export')).toBe(false) // not paid yet

  const paidUntil = new Date('2026-11-09T00:00:00Z')
  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'subscription.started', userId: 'u1', providerId: 'pri_pro', currentPeriodEnd: paidUntil }),
  )
  await billing.handleWebhook(
    fakeBilling.webhook({ type: 'subscription.canceled', userId: 'u1', providerId: 'pri_pro', accessEndsAt: paidUntil }),
  )

  const { holdings } = await billing.account('u1')
  expect(holdings[0]).toMatchObject({ status: 'canceled', accessEndsAt: paidUntil })
  // Canceled, but paid for: the feature stays until the period is over.
  const dayBefore = new Date('2026-11-08T00:00:00Z')
  expect((await billing.entitlements('u1', { now: dayBefore })).has('export')).toBe(true)
  expect((await billing.entitlements('u1', { now: paidUntil })).has('export')).toBe(false)

  const rejected = await billing.handleWebhook(fakeBilling.invalidWebhook())
  expect(rejected.response.status).toBe(401)
}
```

A purchase made on the device is a proof instead of a webhook: `fakeBilling.proof(event)` builds one that `billing.verifyPurchase` takes, for the user who hands it over.

```ts
import { expect } from 'vitest'
import { createBilling, createMemoryBillingStore } from '@loewen-digital/fullstack/billing'
import { createFakeBillingDriver } from '@loewen-digital/fullstack/testing'

async function assertsPurchasesFromTheDevice() {
  const fakeBilling = createFakeBillingDriver()
  const billing = createBilling({
    driver: fakeBilling,
    store: createMemoryBillingStore(),
    products: { unlock: { type: 'one-time', providerId: 'com.example.unlock', features: ['themes'] } },
  })
  const proof = fakeBilling.proof({ type: 'purchase.completed', providerId: 'com.example.unlock', holdingId: 'txn_1' })

  const { events } = await billing.verifyPurchase({ userId: 'u1', proof })
  expect(events).toHaveLength(1)
  expect((await billing.entitlements('u1')).has('themes')).toBe(true)

  // Handed over again: nothing new. Handed over by someone else: refused.
  expect((await billing.verifyPurchase({ userId: 'u1', proof })).events).toEqual([])
  await expect(billing.verifyPurchase({ userId: 'u2', proof })).rejects.toMatchObject({ reason: 'other-user' })
  await expect(
    billing.verifyPurchase({ userId: 'u1', proof: fakeBilling.invalidProof() }),
  ).rejects.toMatchObject({ reason: 'invalid' })
}
```

## What it does not do

Tax, invoices, coupons and seats are the provider's. Of the app stores the module knows Apple's; Google Play is a [driver of your own](#your-own-driver), with `verifyPurchase` as the place where it plugs in. The code that buys on the device is the app's. The module counts no usage: a limit is a number the app reads, not a balance that is spent. It has no paywall and no pricing UI, and it is not `permissions`: that module answers what a role may do, this one what a user has paid for. Partial refunds have no event of their own: a driver reports `payment.refunded` when the purchase is gone, and nothing for a partial one.
