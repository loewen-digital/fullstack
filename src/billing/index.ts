import { applyEvent, scopedId } from './apply.js'
import { createConsoleDriver } from './drivers/console.js'
import { createPaddleDriver } from './drivers/paddle.js'
import { checkEntitlementsConfig, resolveEntitlements } from './entitlements.js'
import { BillingError, BillingPurchaseError, BillingWebhookError } from './errors.js'
import type {
  BillingAccount,
  BillingAccountRecord,
  BillingConfig,
  BillingDriver,
  BillingDriverChoice,
  BillingEntitlementSet,
  BillingEntitlements,
  BillingEvent,
  BillingFeature,
  BillingGrant,
  BillingInstance,
  BillingLimit,
  BillingProducts,
  BillingProductType,
  BillingPurchaseResult,
  BillingRefKind,
  BillingWebhookResult,
  DriverWebhookResult,
  ProviderEvent,
} from './types.js'

export type {
  AppStoreDriverConfig,
  AppStoreEnvironment,
  BillingAccount,
  BillingAccountRecord,
  BillingCheckout,
  BillingConfig,
  BillingDriver,
  BillingDriverChoice,
  BillingEntitlementSet,
  BillingEntitlements,
  BillingEntitlementsConfig,
  BillingEvent,
  BillingEventDetail,
  BillingEventType,
  BillingFeature,
  BillingGrant,
  BillingHolding,
  BillingHoldingStatus,
  BillingInstance,
  BillingLimit,
  BillingProduct,
  BillingProducts,
  BillingProductType,
  BillingPurchaseResult,
  BillingRefKind,
  BillingSkipReason,
  BillingStore,
  BillingWebhookResult,
  CheckoutInput,
  ConsoleDriverConfig,
  DriverCheckoutInput,
  DriverManageInput,
  DriverPurchaseInput,
  DriverPurchaseResult,
  DriverWebhookResult,
  PaddleDriverConfig,
  ProviderEvent,
  PurchaseInput,
} from './types.js'
export type { BillingPurchaseReason } from './errors.js'
export { BillingError, BillingPurchaseError, BillingWebhookError } from './errors.js'
export { appStoreAccountToken, createAppStoreDriver } from './drivers/app-store.js'
export { createConsoleDriver } from './drivers/console.js'
export { createPaddleDriver } from './drivers/paddle.js'
export { createMemoryBillingStore } from './stores/memory.js'

/** A name a provider can go by: it is part of the ids a store keeps, in front of a `:` */
const PROVIDER_NAME = /^[a-z][a-z0-9_-]*$/

/** One provider of the config: its driver, and what the config sells through it */
interface Provider {
  name: string
  driver: BillingDriver
  /** The key of the product in the config, by this provider's id of it */
  productOf: Map<string, string>
  /** This provider's id of each product it sells, by product key */
  providerIds: Record<string, string>
  /** What it sells, by its own id: what a driver gets to verify a purchase */
  sold: Record<string, { product: string; type: BillingProductType }>
}

/** What applying the events of one delivery or one proof came to, next to the events themselves */
interface Applied {
  /** An event has no user or no purchase to belong to yet */
  unmatched: boolean
  /** Every event is in its user's account, applied now or before */
  stored: boolean
}

type Outcome = Pick<BillingWebhookResult, 'events' | 'skipped'>

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a billing instance: checkouts for one-time purchases and subscriptions through one
 * payment provider or several, and what each user holds, learned from what the providers
 * verified: their webhooks, and the proof of a purchase made on the device.
 *
 * Usage:
 *   const billing = createBilling({
 *     driver: 'console',
 *     store: createMemoryBillingStore(),
 *     products: {
 *       unlock: { type: 'one-time', providerId: 'pri_unlock' },
 *       pro: { type: 'subscription', providerId: 'pri_pro' },
 *     },
 *   })
 *
 *   // With Paddle: driver: 'paddle', paddle: { apiKey, webhookSecret, sandbox }
 *   // Several providers: drivers: { paddle: 'paddle', apple: appleDriver }, and each product
 *   // with `providerId: { paddle: 'pri_…', apple: 'com.example.pro' }`
 *
 *   const checkout = await billing.checkout({ userId, product: 'pro', successUrl: '/account' })
 *   // the webhook route: const { response, events } = await billing.handleWebhook(request)
 *   // a purchase from the device: await billing.verifyPurchase({ userId, proof })
 *   const { holdings } = await billing.account(userId)
 *
 * A user is a plain string id. Nothing is granted from a browser coming back from the
 * checkout or from what a client says it bought, only from what a driver verified.
 */
export function createBilling<
  const P extends BillingProducts,
  const D extends BillingEntitlementSet = Record<never, never>,
  V extends string = string,
>(
  config: BillingConfig<P, D, V>,
): BillingInstance<keyof P & string, BillingFeature<P, D>, BillingLimit<P, D>, V> {
  const { store } = config
  const products: BillingProducts = config.products
  const entitlements = config.entitlements ?? {}
  checkEntitlementsConfig(products, entitlements)
  const providers = resolveProviders(config, products)
  const report =
    config.onError ?? ((error: unknown) => console.error('billing: webhook failed', error))

  /** The provider a call names; without a name, the only one there is */
  function providerOf(name: string | undefined): Provider {
    if (name === undefined) {
      if (providers.size === 1) return [...providers.values()][0]!
      throw new BillingError(
        `billing: the config has several drivers (${[...providers.keys()].join(', ')}); say which with \`provider\`.`,
      )
    }
    const provider = providers.get(name)
    if (!provider) throw new BillingError(`billing: unknown provider "${name}"`)
    return provider
  }

  const customerOf = (account: BillingAccountRecord | null, provider: Provider): string | null =>
    account && Object.hasOwn(account.customers, provider.name)
      ? account.customers[provider.name]!
      : null

  /** The ids of an event that are linked to its user */
  const refsOf = (event: ProviderEvent): [BillingRefKind, string][] =>
    event.customerId
      ? [
          ['holding', event.holdingId],
          ['customer', event.customerId],
        ]
      : [['holding', event.holdingId]]

  async function userIdOf(provider: Provider, event: ProviderEvent): Promise<string | null> {
    if (event.userId) return event.userId
    const byHolding = await store.findUserId('holding', scopedId(provider.name, event.holdingId))
    if (byHolding !== null) return byHolding
    return event.customerId
      ? store.findUserId('customer', scopedId(provider.name, event.customerId))
      : null
  }

  /**
   * What an event is about: the product its provider id stands for, or, for an event that names
   * only its holding (a refund), what that holding is. `null` when the holding is not there yet:
   * the purchase is still on its way.
   */
  async function soldBy(
    provider: Provider,
    event: ProviderEvent,
    userId: string,
  ): Promise<{ product: string; type: BillingProductType } | null> {
    if (event.providerId !== undefined) {
      const product = provider.productOf.get(event.providerId)
      return product === undefined ? null : { product, type: products[product]!.type }
    }
    const account = await store.getAccount(userId)
    const held = account?.holdings.find(
      (holding) => holding.provider === provider.name && holding.id === event.holdingId,
    )
    return held ? { product: held.product, type: held.type } : null
  }

  /**
   * The one path every verified event takes into an account, from a webhook or from a proof.
   * `outcome` is filled as it goes, so what was applied before a failure is still reported.
   * `forUser` is the user of a proof: the events are theirs, and their ids are linked already.
   */
  async function applyEvents(
    provider: Provider,
    providerEvents: ProviderEvent[],
    outcome: Outcome,
    forUser?: string,
  ): Promise<Applied> {
    const applied: Applied = { unmatched: false, stored: true }
    for (const providerEvent of providerEvents) {
      if (
        providerEvent.providerId !== undefined &&
        !provider.productOf.has(providerEvent.providerId)
      ) {
        applied.stored = false
        outcome.skipped.push({ reason: 'unknown-product', event: providerEvent })
        continue
      }
      const userId = forUser ?? (await userIdOf(provider, providerEvent))
      const sold = userId === null ? null : await soldBy(provider, providerEvent, userId)
      if (userId === null || sold === null) {
        applied.unmatched = true
        applied.stored = false
        outcome.skipped.push({ reason: 'unmatched', event: providerEvent })
        continue
      }

      // Links first: a later event that names only the holding or the customer (a refund)
      // has to find the user, also when this request dies before the account is written.
      if (forUser === undefined) {
        for (const [kind, id] of refsOf(providerEvent)) {
          await store.link(kind, scopedId(provider.name, id), userId)
        }
      }

      const event = matchedEvent(provider.name, providerEvent, userId, sold.product)
      const result = await store.transact(userId, (account) => {
        const next = applyEvent(account, event, sold.type, providerEvent.customerId)
        return { account: next.account, result: next.outcome }
      })
      if (result === 'applied') outcome.events.push(event)
      else outcome.skipped.push({ reason: result, event: providerEvent })
    }
    return applied
  }

  return {
    async checkout(input) {
      const product = Object.hasOwn(products, input.product) ? products[input.product] : undefined
      if (!product) throw new BillingError(`billing: unknown product "${input.product}"`)
      requireUserId(input.userId)
      const provider = providerOf(input.provider)
      if (!Object.hasOwn(provider.providerIds, input.product)) {
        throw new BillingError(
          `billing: product "${input.product}" is not sold through "${provider.name}"; its providerId names no id there.`,
        )
      }
      const account = await store.getAccount(input.userId)
      return provider.driver.createCheckout({
        userId: input.userId,
        product: input.product,
        type: product.type,
        providerId: provider.providerIds[input.product]!,
        customerId: customerOf(account, provider),
        email: input.email,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      })
    },

    async handleWebhook(request, options = {}) {
      const result: BillingWebhookResult = {
        response: json(200, { received: true }),
        events: [],
        skipped: [],
      }

      let provider: Provider
      let delivery: DriverWebhookResult
      try {
        // Inside the `try`: a route that names no provider, or a wrong one, is answered with 500
        // and reported, like every other failure that is not the sender's.
        provider = providerOf(options.provider)
        delivery = await provider.driver.parseWebhook(request)
      } catch (error) {
        if (error instanceof BillingWebhookError) {
          result.response = json(error.status, { error: error.message })
        } else {
          report(error)
          result.response = json(500, { error: 'webhook failed' })
        }
        return result
      }

      try {
        const applied = await applyEvents(provider, delivery.events, result)
        if (applied.unmatched) {
          // The event that names the user or the purchase may still be on its way; the provider
          // tries again.
          result.response = json(409, { error: 'nothing to match this event to yet' })
          return result
        }
        if (applied.stored) await delivery.settle?.()
        if (delivery.response) result.response = delivery.response
      } catch (error) {
        // Not stored, or not settled: a 500 makes the provider deliver again, and what was
        // applied is skipped then.
        report(error)
        result.response = json(500, { error: 'webhook failed' })
      }
      return result
    },

    async verifyPurchase(input) {
      const provider = providerOf(input.provider)
      requireUserId(input.userId)
      const { driver } = provider
      if (!driver.verifyPurchase) {
        throw new BillingError(
          `billing: the driver of "${provider.name}" takes no purchase from a device; its purchases start with checkout().`,
        )
      }
      const { userId } = input
      const account = await store.getAccount(userId)
      const verified = await driver.verifyPurchase({
        userId,
        proof: input.proof,
        customerId: customerOf(account, provider),
        products: provider.sold,
      })

      // Whose purchase it is comes before anything is written: all of the proof, or none of it.
      const another = (): BillingPurchaseError =>
        new BillingPurchaseError('billing: this purchase belongs to another user.', 'other-user')
      const refs: [BillingRefKind, string][] = []
      for (const event of verified.events) {
        if (event.providerId !== undefined && !provider.productOf.has(event.providerId)) continue
        if (event.userId !== undefined && event.userId !== userId) throw another()
        for (const [kind, id] of refsOf(event)) refs.push([kind, scopedId(provider.name, id)])
      }
      for (const [kind, id] of refs) {
        const owner = await store.findUserId(kind, id)
        if (owner !== null && owner !== userId) throw another()
      }
      for (const [kind, id] of refs) {
        await store.link(kind, id, userId)
        // Two users who hand the same proof over in the same instant: the first link stays.
        if ((await store.findUserId(kind, id)) !== userId) throw another()
      }

      const result: BillingPurchaseResult = { events: [], skipped: [] }
      const applied = await applyEvents(provider, verified.events, result, userId)
      if (applied.stored) await verified.settle?.()
      return result
    },

    async account(userId): Promise<BillingAccount> {
      const account = await store.getAccount(userId)
      return {
        userId,
        customers: account?.customers ?? {},
        holdings: account?.holdings ?? [],
        grants: account?.grants ?? [],
      }
    },

    async manageUrl(userId, options = {}) {
      requireUserId(userId)
      const provider = providerOf(options.provider)
      const account = await store.getAccount(userId)
      return provider.driver.createManageUrl({
        userId,
        customerId: customerOf(account, provider),
        holdings: (account?.holdings ?? []).filter((holding) => holding.provider === provider.name),
        providerIds: provider.providerIds,
        returnUrl: options.returnUrl,
      })
    },

    async entitlements(userId, options = {}) {
      requireUserId(userId)
      const account = await store.getAccount(userId)
      // The names are checked against the config where they are typed; here they are strings.
      return resolveEntitlements(
        userId,
        account,
        products,
        entitlements,
        options.now ?? new Date(),
      ) as BillingEntitlements<BillingFeature<P, D>, BillingLimit<P, D>, keyof P & string>
    },

    async grant(userId, product, options = {}) {
      requireUserId(userId)
      if (!Object.hasOwn(products, product)) {
        throw new BillingError(`billing: unknown product "${product}"`)
      }
      const until = options.until ?? null
      if (until !== null && Number.isNaN(until.getTime())) {
        throw new BillingError('billing: `until` of a grant is not a valid date')
      }
      const grant: BillingGrant = { product, grantedAt: new Date(), until }
      await store.transact(userId, (account) => ({
        account: {
          ...account,
          grants: [...account.grants.filter((entry) => entry.product !== product), grant],
        },
        result: undefined,
      }))
      return grant
    },

    async revoke(userId, product) {
      requireUserId(userId)
      return store.transact(userId, (account) => {
        const grants = account.grants.filter((entry) => entry.product !== product)
        if (grants.length === account.grants.length) return { result: false }
        return { account: { ...account, grants }, result: true }
      })
    },
  }
}

/**
 * The event as the app sees it: its own user id and product key instead of the provider's ids,
 * and the name of the provider it came from
 */
function matchedEvent(
  provider: string,
  event: ProviderEvent,
  userId: string,
  product: string,
): BillingEvent {
  const matched: Record<string, unknown> = { ...event, provider, userId, product }
  delete matched.customerId
  delete matched.providerId
  return matched as BillingEvent
}

/**
 * The providers of a config, by name, each with what the config sells through it. One `driver`
 * is a provider named after it; `drivers` names each one itself.
 */
function resolveProviders(
  config: Pick<BillingConfig, 'driver' | 'drivers' | 'console' | 'paddle'>,
  products: BillingProducts,
): Map<string, Provider> {
  if (config.driver !== undefined && config.drivers !== undefined) {
    throw new BillingError(
      'billing: the config has `driver` and `drivers`; set one provider with `driver`, or all of them in `drivers`.',
    )
  }
  const drivers: [string, BillingDriver][] = []
  if (config.drivers !== undefined) {
    if (typeof config.drivers !== 'object' || config.drivers === null) {
      throw new BillingError('billing: `drivers` is not an object of drivers by name.')
    }
    for (const [name, choice] of Object.entries<BillingDriverChoice>(config.drivers)) {
      drivers.push([name, resolveDriver(choice, config)])
    }
    if (drivers.length === 0) throw new BillingError('billing: `drivers` is empty.')
  } else if (config.driver !== undefined) {
    const driver = resolveDriver(config.driver, config)
    drivers.push([driver.name, driver])
  } else {
    throw new BillingError(
      'billing: the config needs a `driver`, or `drivers` for several providers.',
    )
  }

  const providers = new Map<string, Provider>()
  for (const [name, driver] of drivers) {
    if (typeof name !== 'string' || !PROVIDER_NAME.test(name)) {
      throw new BillingError(
        `billing: ${JSON.stringify(name)} cannot name a provider. A name is lower-case letters, digits, "_" and "-", and starts with a letter.`,
      )
    }
    providers.set(name, { name, driver, productOf: new Map(), providerIds: {}, sold: {} })
  }
  const only = providers.size === 1 ? [...providers.values()][0]! : null

  for (const [key, product] of Object.entries(products)) {
    const ids = product.providerId
    let entries: [string, unknown][]
    if (typeof ids === 'string') {
      if (!only) {
        throw new BillingError(
          `billing: product "${key}" has one providerId, and the config has several drivers. Write it by provider: { ${[...providers.keys()].join(', ')} }.`,
        )
      }
      entries = [[only.name, ids]]
    } else if (typeof ids === 'object' && ids !== null) {
      entries = Object.entries(ids)
    } else {
      throw new BillingError(`billing: product "${key}" has no providerId.`)
    }

    for (const [name, id] of entries) {
      const provider = providers.get(name)
      if (!provider) {
        throw new BillingError(
          `billing: product "${key}" has a providerId for "${name}", which is not a driver of the config (${[...providers.keys()].join(', ')}).`,
        )
      }
      if (typeof id !== 'string' || id === '') {
        throw new BillingError(`billing: the providerId of product "${key}" is empty.`)
      }
      const taken = provider.productOf.get(id)
      if (taken !== undefined) {
        throw new BillingError(
          `billing: products "${taken}" and "${key}" share the providerId "${id}" at "${name}"; events could not be told apart.`,
        )
      }
      provider.productOf.set(id, key)
      provider.providerIds[key] = id
      provider.sold[id] = { product: key, type: product.type }
    }
  }
  return providers
}

function resolveDriver(
  choice: BillingDriverChoice,
  config: Pick<BillingConfig, 'console' | 'paddle'>,
): BillingDriver {
  if (choice === 'console') return createConsoleDriver(config.console)
  if (choice === 'paddle') {
    if (!config.paddle) {
      throw new BillingError(
        'billing: driver "paddle" needs the `paddle` options (apiKey, webhookSecret)',
      )
    }
    return createPaddleDriver(config.paddle)
  }
  if (typeof choice === 'object' && choice !== null) return choice
  throw new BillingError(`billing: unknown driver "${String(choice)}"`)
}

function requireUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '') {
    throw new BillingError('billing: userId must be a non-empty string')
  }
}
