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
  /** The provider's id of what is sold (a price or product id); events are matched through it */
  providerId: string
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
 * An event as a driver hands it over after verifying the webhook: the provider's ids, not yet
 * matched to a user of the app or a product of the config.
 */
export type ProviderEvent = BillingEventDetail & {
  /** The provider's id of the event; an event is applied once per id */
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
}

/** A provider event matched to a user id and a product of the config */
export type BillingEvent = BillingEventDetail & {
  id: string
  occurredAt: Date
  userId: string
  /** The key of the product in the config */
  product: string
  holdingId: string
}

export type BillingHoldingStatus = 'active' | 'past_due' | 'canceled' | 'refunded'

/** One thing a user bought: a one-time purchase or a subscription, in its current state */
export interface BillingHolding {
  /** The provider's id of the purchase or subscription */
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
  /** The provider's customer for this user; `null` until an event names one */
  customerId: string | null
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
 * Where billing keeps its state. Four methods; `transact` carries the guarantee: no update of
 * an account is lost, however many requests write it at the same time.
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
  customerId: string | null
  holdings: BillingHolding[]
  /** The provider's id of each product in the config, by product key */
  providerIds: Record<string, string>
  returnUrl?: string
}

export interface DriverWebhookResult {
  events: ProviderEvent[]
  /** The answer the provider expects, when it is not a plain 200 */
  response?: Response
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
}

export interface ConsoleDriverConfig {
  /**
   * The URL of the route that hands requests to `billing.handleWebhook` (default:
   * `/billing/webhook`). The console driver sends the browser there to complete a checkout.
   */
  webhookUrl?: string
  /** Length of a subscription period in days (default: 30) */
  periodDays?: number
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
> {
  /**
   * `'console'` completes checkouts locally without a provider; `'paddle'` sells through Paddle
   * Billing and needs the `paddle` options; or a driver of your own
   */
  driver: 'console' | 'paddle' | BillingDriver
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

export interface CheckoutInput<K extends string = string> {
  userId: string
  product: K
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

export interface BillingInstance<
  K extends string = string,
  F extends string = string,
  L extends string = string,
> {
  /** Starts a checkout of a product for a user and returns what the client needs to continue */
  checkout(input: CheckoutInput<K>): Promise<BillingCheckout>
  /**
   * Takes a webhook request of the provider: the driver verifies it, every event in it is
   * applied to the account of its user, and the answer for the provider comes back.
   */
  handleWebhook(request: Request): Promise<BillingWebhookResult>
  /** What the user holds, from the store, without a call to the provider */
  account(userId: string): Promise<BillingAccount>
  /** The link where the user manages or cancels what they bought */
  manageUrl(userId: string, options?: { returnUrl?: string }): Promise<string | null>
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
}
