/** How a product is sold: paid once and kept, or paid per period */
export type BillingProductType = 'one-time' | 'subscription'

/** What a product gives the user who holds it, or the default gives everyone */
export interface BillingEntitlementSet {
  /** Named features this unlocks: `['export', 'themes']` */
  features?: readonly string[]
  /** Numeric limits this sets, by name: `{ feeds: 500 }`. `Infinity` for no limit */
  limits?: Readonly<Record<string, number>>
}

export interface BillingProduct extends BillingEntitlementSet {
  type: BillingProductType
  /**
   * The provider's id of what is sold (a price or product id); events are matched through it.
   * With several `drivers`, the id at each provider that sells the product, by the name of the
   * provider: `{ paddle: 'pri_…', apple: 'com.example.pro' }`. `{}` for a product nobody sells,
   * one that is only given by hand.
   */
  providerId: string | Readonly<Record<string, string>>
}

export type BillingProducts = Record<string, BillingProduct>

/** The part of an event that differs per type */
export type BillingEventDetail =
  | { type: 'purchase.completed' }
  | {
      type: 'subscription.started' | 'subscription.renewed' | 'subscription.changed'
      /** The end of the period that is paid for; `null` when the provider does not say */
      currentPeriodEnd: Date | null
    }
  | {
      type: 'subscription.canceled'
      /** The moment access ends: the end of the paid period, or now for an immediate cancel */
      accessEndsAt: Date
    }
  | { type: 'payment.failed' }
  | { type: 'payment.refunded' }

export type BillingEventType = BillingEventDetail['type']

/**
 * An event as a driver hands it over after verifying a webhook or the proof of a purchase: the
 * provider's ids, not yet matched to a user of the app or a product of the config.
 */
export type ProviderEvent = BillingEventDetail & {
  /**
   * The id of the event; an event is applied once per id. It has to be the same however the
   * driver learned of the event, from a webhook or from a proof
   */
  id: string
  /** The provider's timestamp of the event; an older event never overwrites a newer state */
  occurredAt: Date
  /** The user id the checkout carried, when the event has it */
  userId?: string
  /** The provider's customer id, when the event has it */
  customerId?: string
  /**
   * The provider's id of the product, as in `BillingProduct.providerId`. Left out when the
   * provider's event does not say what was sold (a refund that names only its transaction):
   * billing then takes the product of the holding, which has to exist by then.
   */
  providerId?: string
  /** The provider's id of the purchase (one-time) or the subscription the event is about */
  holdingId: string
  /**
   * The holding this one takes the place of, for a provider that books a change of plan as a new
   * purchase (Google Play): the event ends that holding in the same step, and an event without
   * a user belongs to the user of that holding.
   */
  replacesHoldingId?: string
}

/** A provider event matched to a user id and a product of the config */
export type BillingEvent = BillingEventDetail & {
  /** The provider's id of the event; unique per provider */
  id: string
  /** The name of the provider the event came from */
  provider: string
  occurredAt: Date
  userId: string
  /** The key of the product in the config */
  product: string
  holdingId: string
  /** The holding this one took the place of, when the provider booked a change as a new purchase */
  replacesHoldingId?: string
}

export type BillingHoldingStatus = 'active' | 'past_due' | 'canceled' | 'refunded'

/** One thing a user bought: a one-time purchase or a subscription, in its current state */
export interface BillingHolding {
  /** Who sold it: the name of the provider, as in `drivers`, or the name of the one `driver` */
  provider: string
  /** The provider's id of the purchase or subscription; unique per provider */
  id: string
  /** The key of the product in the config */
  product: string
  type: BillingProductType
  /**
   * `active`: paid. `past_due`: the last payment of a subscription failed and the provider has
   * not given up. `canceled`: ends or ended at `accessEndsAt`. `refunded`: the money went back.
   */
  status: BillingHoldingStatus
  /** When the first event of this holding happened */
  startedAt: Date
  /** Subscriptions: the end of the period that is paid for */
  currentPeriodEnd: Date | null
  /** Set by a cancel (the date access ends) and by a refund (the date of the refund) */
  accessEndsAt: Date | null
  /** Since when the holding is `past_due`: the time of the first failed payment; otherwise `null` */
  pastDueSince: Date | null
  /** The time of the newest event applied to this holding */
  updatedAt: Date
}

/** A product given to a user by hand: a tester, a gift. No provider event touches it */
export interface BillingGrant {
  /** The key of the product in the config */
  product: string
  grantedAt: Date
  /** The moment the grant ends; `null` for a grant without an end */
  until: Date | null
}

/** What billing knows about one user */
export interface BillingAccount {
  userId: string
  /** The customer this user is at each provider, by provider; empty until an event names one */
  customers: Record<string, string>
  /** What the user bought, at every provider */
  holdings: BillingHolding[]
  /** What was given by hand with `billing.grant()`, one entry per product at most */
  grants: BillingGrant[]
}

/** A `BillingAccount` as a store keeps it, with the ids of the events already applied */
export interface BillingAccountRecord extends BillingAccount {
  appliedEvents: string[]
}

/** The kinds of provider ids a store maps back to a user id */
export type BillingRefKind = 'customer' | 'holding'

/**
 * Where billing keeps its state. Five methods; `transact` carries the guarantee: no update of
 * an account is lost, however many requests write it at the same time.
 *
 * The ids `link` and `findUserId` get are a provider's id behind the name of its provider
 * (`paddle:ctm_01h…`), so the ids of two providers never meet.
 */
export interface BillingStore {
  /** The account of a user, or `null` when no event for the user was ever applied */
  getAccount(userId: string): Promise<BillingAccountRecord | null>
  /**
   * Reads the account (an empty one for an unknown user), calls `change` and stores the account
   * it returns, as one atomic step. A store that lost a race calls `change` again on the fresh
   * account, so `change` must be free of side effects. Without `account` in the answer nothing
   * is written.
   */
  transact<R>(
    userId: string,
    change: (account: BillingAccountRecord) => { account?: BillingAccountRecord; result: R },
  ): Promise<R>
  /** Remembers which user a provider id belongs to. The first link of an id stays. */
  link(kind: BillingRefKind, id: string, userId: string): Promise<void>
  /** The user id a provider id was linked to */
  findUserId(kind: BillingRefKind, id: string): Promise<string | null>
  /**
   * Removes the account of a user and the links that lead to them, so that `getAccount` answers
   * `null` and no provider id finds the user any more. Links of other users stay. A user the
   * store does not know is no error.
   */
  forget(userId: string): Promise<void>
}

export interface BillingCheckout {
  /** The provider's id of the checkout (Paddle: the transaction, which Paddle.js opens) */
  id: string
  /** Where to send the browser to pay; `null` when the provider's checkout has no page of its own */
  url: string | null
}

/** What a driver gets to start a checkout */
export interface DriverCheckoutInput {
  userId: string
  /** The key of the product in the config */
  product: string
  type: BillingProductType
  providerId: string
  /** The provider's customer of the user, when billing already knows one */
  customerId: string | null
  email?: string
  successUrl?: string
  cancelUrl?: string
}

/** What a driver gets to build the link where a user manages what they bought */
export interface DriverManageInput {
  userId: string
  /** The user's customer at this provider, when billing already knows one */
  customerId: string | null
  /** What the user holds from this provider; holdings of other providers are left out */
  holdings: BillingHolding[]
  /** This provider's id of each product it sells, by product key */
  providerIds: Record<string, string>
  returnUrl?: string
}

export interface DriverWebhookResult {
  events: ProviderEvent[]
  /** The answer the provider expects, when it is not a plain 200 */
  response?: Response
  /**
   * Called once every event of the delivery is in its user's account, applied now or before: the
   * place to tell the provider that the purchase was delivered (Google Play refunds a purchase
   * nobody acknowledged). Not called while an event waits for its user or names a product the
   * config does not have. When it throws, the delivery is answered with 500 and comes again.
   */
  settle?(): Promise<void>
  /**
   * Answer the delivery as received when an event has no user to belong to, instead of the 409
   * that makes the provider deliver again. For a provider whose deliveries only say that a
   * purchase changed, so the driver reads the purchase as it is now (Google Play): a second
   * delivery reads the same, and so does the hand-over of the purchase.
   */
  acceptUnmatched?: boolean
}

/** What a driver gets to verify a purchase that was made on the device */
export interface DriverPurchaseInput {
  /** The signed-in user who hands the proof over */
  userId: string
  /** What the app got from the device, as it came. Untrusted until the driver verified it */
  proof: unknown
  /** The user's customer at this provider, when billing already knows one */
  customerId: string | null
  /** What the config sells through this provider, by the provider's id */
  products: Record<string, { product: string; type: BillingProductType }>
}

export interface DriverPurchaseResult {
  /** What the verified proof says, as events. Billing applies them for the user who handed it over */
  events: ProviderEvent[]
  /** As `settle` of a webhook delivery. When it throws, `verifyPurchase` of billing throws */
  settle?(): Promise<void>
  /**
   * For a proof that may be out of date: asks the provider what the purchase is today, and
   * answers the events that take the place of `events`. Billing calls it before the proof adds
   * anything to the account, and only then: a proof whose events are all in the account costs no
   * request. When it throws, `verifyPurchase` of billing throws and nothing is changed.
   */
  refresh?(): Promise<ProviderEvent[]>
}

/** A payment provider behind the module */
export interface BillingDriver {
  readonly name: string
  createCheckout(input: DriverCheckoutInput): Promise<BillingCheckout>
  /**
   * Verifies the request on its raw body and returns the events in it. Throws
   * `BillingWebhookError` when the request is not a valid delivery of the provider.
   */
  parseWebhook(request: Request): Promise<DriverWebhookResult>
  /** The link where the user manages or cancels; `null` when the provider has nothing to manage yet */
  createManageUrl(input: DriverManageInput): Promise<string | null>
  /**
   * Verifies the proof of a purchase made on the device with the provider and returns what it
   * says. Throws `BillingPurchaseError` when the proof is not a valid one of the provider, or
   * when it names another user than `userId`. A provider whose purchases start on the server
   * (Paddle) leaves it out.
   */
  verifyPurchase?(input: DriverPurchaseInput): Promise<DriverPurchaseResult>
}

/** A driver in the config: the name of a built-in one, or a driver */
export type BillingDriverChoice = 'console' | 'paddle' | BillingDriver

export interface ConsoleDriverConfig {
  /**
   * The URL of the route that hands requests to `billing.handleWebhook` (default:
   * `/billing/webhook`). The console driver sends the browser there to complete a checkout, and
   * serves the page behind its manage link from it.
   */
  webhookUrl?: string
  /** Length of a subscription period in days (default: 30), for a checkout and for a purchase from the device */
  periodDays?: number
}

/**
 * What the console driver plays for a holding after its purchase: `cancel` ends a subscription
 * with the period that is paid for, `cancel-now` ends it at once, `refund` pays back a
 * subscription or a purchase paid once.
 */
export type ConsoleAction = 'cancel' | 'cancel-now' | 'refund'

/** What `createConsoleDriver` returns: a driver, and the link of one action for a test */
export interface ConsoleDriver extends BillingDriver {
  /**
   * The link that plays one action for a holding, as the page behind the manage link has them:
   * hand it to `billing.handleWebhook` as a GET, or open it. The event names the holding only,
   * so billing finds the user through the purchase; the time of the event is the time of this
   * call. Each call is an event of its own, and opening one link twice delivers the same event
   * again. Throws a `BillingError` for an action that does not fit: a purchase paid once is not
   * canceled.
   */
  actionUrl(
    holding: Pick<BillingHolding, 'id' | 'type' | 'currentPeriodEnd'>,
    action: ConsoleAction,
    options?: { returnUrl?: string },
  ): string
}

export interface PaddleDriverConfig {
  /** A server-side API key of Paddle Billing. A secret: read it from the environment */
  apiKey: string
  /** The secret key of the notification destination that delivers to the webhook route. A secret */
  webhookSecret: string
  /** Talk to Paddle's sandbox instead of the live API (default: `false`) */
  sandbox?: boolean
  /**
   * The page of the app that opens the checkout with Paddle.js. Its domain has to be approved in
   * Paddle. Default: the default payment link set in Paddle.
   */
  checkoutUrl?: string
  /** How far the timestamp of a webhook's signature may be from now, in seconds (default: 5) */
  toleranceSeconds?: number
}

/** The App Store runs two environments; what one signed is unknown to the other */
export type AppStoreEnvironment = 'production' | 'sandbox'

/**
 * An In-App Purchase key of App Store Connect (Users and Access, Integrations), which the App
 * Store Server API takes. One key serves production and the sandbox.
 */
export interface AppStoreApiKey {
  /** The issuer id, shown above the keys */
  issuerId: string
  /** The id of the key */
  keyId: string
  /** The contents of the `.p8` file of the key. A secret: read it from the environment */
  privateKey: string
}

export interface AppStoreDriverConfig {
  /** The bundle id of the app that sells. What the App Store signed for another app is refused */
  bundleId: string
  /**
   * The environment this provider takes; what comes from the other one is refused. A purchase in
   * the sandbox costs nothing: give the sandbox a provider of its own, under its own name.
   */
  environment: AppStoreEnvironment
  /**
   * With a key, the driver asks Apple what a transaction is today before it applies one that was
   * signed more than a day ago and is not in the account yet: one that was refunded in the
   * meantime is applied as refunded. Without a key the driver asks Apple nothing.
   */
  apiKey?: AppStoreApiKey
  /**
   * The root certificates a signature's chain may end in, as DER bytes, base64 or PEM (default:
   * Apple Root CA - G3). For tests that sign with a chain of their own.
   */
  rootCertificates?: readonly (Uint8Array | string)[]
  /** Milliseconds to wait for an answer of Apple (default: 15000) */
  timeoutMs?: number
  /** Replaces the global `fetch`: for tests */
  fetch?: typeof fetch
}

export interface GooglePlayDriverConfig {
  /** The package name of the Android app that sells. A purchase of another app is refused */
  packageName: string
  /** Who the driver is to Google: `client_email` of the service account's key file */
  clientEmail: string
  /** `private_key` of the service account's key file. A secret: read it from the environment */
  privateKey: string
  /**
   * The audience of the push subscription that delivers the notifications, as set there. A
   * request whose token names another one is refused.
   */
  pushAudience: string
  /**
   * The service account the push subscription signs its requests as, when it is not
   * `clientEmail`. A request whose token names another one is refused.
   */
  pushServiceAccount?: string
  /**
   * The product ids at Google Play that are used up once they are applied (credits, coins): the
   * driver consumes such a purchase, so the product can be bought again. Every other one-time
   * product is acknowledged and kept.
   */
  consumables?: readonly string[]
  /** Milliseconds to wait for an answer of Google (default: 15000) */
  timeoutMs?: number
  /** Replaces the global `fetch`: for tests */
  fetch?: typeof fetch
}

export interface BillingEntitlementsConfig<
  D extends BillingEntitlementSet = BillingEntitlementSet,
> {
  /** What every user has, also one who bought nothing */
  default?: D
  /**
   * How many days a subscription keeps granting after its payment failed. Left out: for as long
   * as the provider keeps trying, which is until it cancels the subscription. `0`: not at all.
   */
  pastDueGraceDays?: number
}

type FeaturesIn<S> = S extends { features: readonly (infer F extends string)[] } ? F : never
type LimitsIn<S> = S extends { limits: infer L } ? keyof L & string : never

/** The feature names a billing config declares, on its products and in its default */
export type BillingFeature<P, D = never> = FeaturesIn<P[keyof P]> | FeaturesIn<D>
/** The limit names a billing config declares, on its products and in its default */
export type BillingLimit<P, D = never> = LimitsIn<P[keyof P]> | LimitsIn<D>

/** What a user may use right now, from what they paid for and what they were given */
export interface BillingEntitlements<
  F extends string = string,
  L extends string = string,
  K extends string = string,
> {
  userId: string
  /** The products that grant right now, paid or given by hand */
  products: K[]
  /** Every feature the default and those products unlock */
  features: F[]
  /** Every limit of the config with the highest value the default and those products set; `0` when none does */
  limits: Record<L, number>
  /** Whether the user has a feature */
  has(feature: F): boolean
  /** A limit for the user; `0` when nothing sets it */
  limit(name: L): number
}

export interface BillingConfig<
  P extends BillingProducts = BillingProducts,
  D extends BillingEntitlementSet = BillingEntitlementSet,
  V extends string = string,
> {
  /**
   * One provider. `'console'` completes checkouts locally without a provider; `'paddle'` sells
   * through Paddle Billing and needs the `paddle` options; or a driver of your own. The provider
   * is named after the driver (`'console'`, `'paddle'`, the `name` of yours).
   */
  driver?: BillingDriverChoice
  /**
   * Several providers side by side, instead of `driver`: each under a name of your choice, which
   * is what holdings, events and calls name it by. `{ paddle: 'paddle', apple: appleDriver }`
   */
  drivers?: Record<V, BillingDriverChoice>
  /** What the app sells, by a key of your choice, each with the features and limits it gives */
  products: P
  /** What `entitlements()` answers beyond the products: the default for everyone, the grace period */
  entitlements?: BillingEntitlementsConfig<D>
  /** Where accounts are kept: `createMemoryBillingStore()`, `createFlatdbBillingStore()`, your own */
  store: BillingStore
  /** Options of the console driver */
  console?: ConsoleDriverConfig
  /** Options of the Paddle driver; required with `driver: 'paddle'` */
  paddle?: PaddleDriverConfig
  /** Called with what the store or the driver threw inside `handleWebhook` (default: `console.error`) */
  onError?: (error: unknown) => void
}

export interface CheckoutInput<K extends string = string, V extends string = string> {
  userId: string
  product: K
  /** The provider to buy from. Required with several `drivers` */
  provider?: V
  /** Prefills the provider's checkout */
  email?: string
  /** Where the provider sends the browser after the payment */
  successUrl?: string
  /** Where the provider sends the browser when the user gives up */
  cancelUrl?: string
}

/** Why an event of a delivery changed nothing */
export type BillingSkipReason =
  /** The event was applied before */
  | 'duplicate'
  /** A newer event of the same holding was applied before */
  | 'stale'
  /** The holding already was in the state the event describes */
  | 'unchanged'
  /**
   * No user id on the event and none linked to its holding or customer, or no product on the
   * event and no holding to take it from
   */
  | 'unmatched'
  /** The provider's product id is not in the config */
  | 'unknown-product'

export interface BillingWebhookResult {
  /** What to answer the provider with */
  response: Response
  /** The events of this delivery that changed state, each exactly once across all deliveries */
  events: BillingEvent[]
  /** The events of this delivery that changed nothing, and why */
  skipped: { reason: BillingSkipReason; event: ProviderEvent }[]
}

export interface PurchaseInput<V extends string = string> {
  /** The provider the purchase was made at. Required with several `drivers` */
  provider?: V
  /** The signed-in user who hands the proof over */
  userId: string
  /** What the device got from the provider for the purchase, as the app received it */
  proof: unknown
}

export interface BillingPurchaseResult {
  /** The events of the proof that changed state, each exactly once across proofs and webhooks */
  events: BillingEvent[]
  /** The events of the proof that changed nothing, and why */
  skipped: { reason: BillingSkipReason; event: ProviderEvent }[]
}

export interface BillingInstance<
  K extends string = string,
  F extends string = string,
  L extends string = string,
  V extends string = string,
> {
  /** Starts a checkout of a product for a user and returns what the client needs to continue */
  checkout(input: CheckoutInput<K, V>): Promise<BillingCheckout>
  /**
   * Takes a webhook request of a provider: the driver verifies it, every event in it is
   * applied to the account of its user, and the answer for the provider comes back. With
   * several `drivers`, `provider` says whose request it is.
   */
  handleWebhook(request: Request, options?: { provider?: V }): Promise<BillingWebhookResult>
  /**
   * Takes the proof of a purchase that was made on the device, from the signed-in user: the
   * driver verifies it with the provider, and what it says is applied through the same path as
   * a webhook's events, each exactly once. Throws `BillingPurchaseError` and changes nothing
   * when the proof does not verify or the purchase belongs to another user.
   */
  verifyPurchase(input: PurchaseInput<V>): Promise<BillingPurchaseResult>
  /** What the user holds, from the store, without a call to the provider */
  account(userId: string): Promise<BillingAccount>
  /**
   * The link where the user manages or cancels what they bought from a provider. With several
   * `drivers`, `provider` says which: hand it the `provider` of the holding, which is why it
   * takes any string. A name the config does not have throws.
   */
  manageUrl(
    userId: string,
    options?: { provider?: V | (string & {}); returnUrl?: string },
  ): Promise<string | null>
  /**
   * What the user may use right now: the features and limits of the default, of every product
   * they hold in a granting state and of every product given by hand. One read from the store,
   * no call to the provider. `now` is for tests.
   */
  entitlements(userId: string, options?: { now?: Date }): Promise<BillingEntitlements<F, L, K>>
  /**
   * Gives a user a product by hand, until `until` or for good. Independent of the provider: no
   * event changes or removes it. A second grant of the same product replaces the first.
   */
  grant(userId: string, product: K, options?: { until?: Date }): Promise<BillingGrant>
  /** Takes back what `grant()` gave; `false` when there was nothing. What the user paid for stays */
  revoke(userId: string, product: K): Promise<boolean>
  /**
   * Removes everything billing keeps about a user: the account with its holdings, its grants and
   * the events applied to it, and the links from the provider's ids to the user. For the day the
   * account is deleted. A user billing has never seen is no error.
   *
   * No provider is told: a subscription that runs goes on and is charged, and the customer stays
   * the provider's. An event that names the user and arrives afterwards starts their account anew.
   */
  forget(userId: string): Promise<void>
}
