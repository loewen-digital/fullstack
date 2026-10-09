import { applyEvent } from './apply.js'
import { createConsoleDriver } from './drivers/console.js'
import { createPaddleDriver } from './drivers/paddle.js'
import { checkEntitlementsConfig, resolveEntitlements } from './entitlements.js'
import { BillingError, BillingWebhookError } from './errors.js'
import type {
  BillingAccount,
  BillingConfig,
  BillingDriver,
  BillingEntitlementSet,
  BillingEntitlements,
  BillingEvent,
  BillingFeature,
  BillingGrant,
  BillingInstance,
  BillingLimit,
  BillingProducts,
  BillingProductType,
  BillingWebhookResult,
  DriverWebhookResult,
  ProviderEvent,
} from './types.js'

export type {
  BillingAccount,
  BillingAccountRecord,
  BillingCheckout,
  BillingConfig,
  BillingDriver,
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
  BillingRefKind,
  BillingSkipReason,
  BillingStore,
  BillingWebhookResult,
  CheckoutInput,
  ConsoleDriverConfig,
  DriverCheckoutInput,
  DriverManageInput,
  DriverWebhookResult,
  PaddleDriverConfig,
  ProviderEvent,
} from './types.js'
export { BillingError, BillingWebhookError } from './errors.js'
export { createConsoleDriver } from './drivers/console.js'
export { createPaddleDriver } from './drivers/paddle.js'
export { createMemoryBillingStore } from './stores/memory.js'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a billing instance: checkouts for one-time purchases and subscriptions through a
 * payment provider, and what each user holds, learned from the provider's verified webhooks.
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
 *
 *   const checkout = await billing.checkout({ userId, product: 'pro', successUrl: '/account' })
 *   // the webhook route: const { response, events } = await billing.handleWebhook(request)
 *   const { holdings } = await billing.account(userId)
 *
 * A user is a plain string id. Nothing is granted from a browser coming back from the
 * checkout, only from an event the driver verified.
 */
export function createBilling<
  const P extends BillingProducts,
  const D extends BillingEntitlementSet = Record<never, never>,
>(
  config: BillingConfig<P, D>,
): BillingInstance<keyof P & string, BillingFeature<P, D>, BillingLimit<P, D>> {
  const { store } = config
  const products: BillingProducts = config.products
  const entitlements = config.entitlements ?? {}
  checkEntitlementsConfig(products, entitlements)
  const driver = resolveDriver(config)
  const report =
    config.onError ?? ((error: unknown) => console.error('billing: webhook failed', error))

  const productByProviderId = new Map<string, string>()
  const providerIds: Record<string, string> = {}
  for (const [key, product] of Object.entries(products)) {
    if (productByProviderId.has(product.providerId)) {
      throw new BillingError(
        `billing: products "${productByProviderId.get(product.providerId)}" and "${key}" share the providerId "${product.providerId}"; events could not be told apart.`,
      )
    }
    productByProviderId.set(product.providerId, key)
    providerIds[key] = product.providerId
  }

  async function userIdOf(event: ProviderEvent): Promise<string | null> {
    if (event.userId) return event.userId
    const byHolding = await store.findUserId('holding', event.holdingId)
    if (byHolding !== null) return byHolding
    return event.customerId ? store.findUserId('customer', event.customerId) : null
  }

  /**
   * What an event is about: the product its provider id stands for, or, for an event that names
   * only its holding (a refund), what that holding is. `null` when the holding is not there yet:
   * the purchase is still on its way.
   */
  async function soldBy(
    event: ProviderEvent,
    userId: string,
  ): Promise<{ product: string; type: BillingProductType } | null> {
    if (event.providerId !== undefined) {
      const product = productByProviderId.get(event.providerId)
      return product === undefined ? null : { product, type: products[product]!.type }
    }
    const account = await store.getAccount(userId)
    const held = account?.holdings.find((holding) => holding.id === event.holdingId)
    return held ? { product: held.product, type: held.type } : null
  }

  return {
    async checkout(input) {
      const product = Object.hasOwn(products, input.product) ? products[input.product] : undefined
      if (!product) throw new BillingError(`billing: unknown product "${input.product}"`)
      requireUserId(input.userId)
      const account = await store.getAccount(input.userId)
      return driver.createCheckout({
        userId: input.userId,
        product: input.product,
        type: product.type,
        providerId: product.providerId,
        customerId: account?.customerId ?? null,
        email: input.email,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      })
    },

    async handleWebhook(request) {
      const result: BillingWebhookResult = {
        response: json(200, { received: true }),
        events: [],
        skipped: [],
      }

      let delivery: DriverWebhookResult
      try {
        delivery = await driver.parseWebhook(request)
      } catch (error) {
        if (error instanceof BillingWebhookError) {
          result.response = json(error.status, { error: error.message })
        } else {
          report(error)
          result.response = json(500, { error: 'webhook failed' })
        }
        return result
      }

      let unmatched = false
      try {
        for (const providerEvent of delivery.events) {
          if (
            providerEvent.providerId !== undefined &&
            !productByProviderId.has(providerEvent.providerId)
          ) {
            result.skipped.push({ reason: 'unknown-product', event: providerEvent })
            continue
          }
          const userId = await userIdOf(providerEvent)
          const sold = userId === null ? null : await soldBy(providerEvent, userId)
          if (userId === null || sold === null) {
            unmatched = true
            result.skipped.push({ reason: 'unmatched', event: providerEvent })
            continue
          }

          // Links first: a later event that names only the holding or the customer (a refund)
          // has to find the user, also when this request dies before the account is written.
          await store.link('holding', providerEvent.holdingId, userId)
          if (providerEvent.customerId) {
            await store.link('customer', providerEvent.customerId, userId)
          }

          const event = matchedEvent(providerEvent, userId, sold.product)
          const outcome = await store.transact(userId, (account) => {
            const applied = applyEvent(account, event, sold.type, providerEvent.customerId)
            return { account: applied.account, result: applied.outcome }
          })
          if (outcome === 'applied') result.events.push(event)
          else result.skipped.push({ reason: outcome, event: providerEvent })
        }
      } catch (error) {
        // Not stored: a 500 makes the provider deliver again, and what was applied is skipped then.
        report(error)
        result.response = json(500, { error: 'webhook failed' })
        return result
      }

      if (unmatched) {
        // The event that names the user or the purchase may still be on its way; the provider
        // tries again.
        result.response = json(409, { error: 'nothing to match this event to yet' })
      } else if (delivery.response) {
        result.response = delivery.response
      }
      return result
    },

    async account(userId): Promise<BillingAccount> {
      const account = await store.getAccount(userId)
      return {
        userId,
        customerId: account?.customerId ?? null,
        holdings: account?.holdings ?? [],
        grants: account?.grants ?? [],
      }
    },

    async manageUrl(userId, options = {}) {
      requireUserId(userId)
      const account = await store.getAccount(userId)
      return driver.createManageUrl({
        userId,
        customerId: account?.customerId ?? null,
        holdings: account?.holdings ?? [],
        providerIds,
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

/** The event as the app sees it: its own user id and product key instead of the provider's ids */
function matchedEvent(event: ProviderEvent, userId: string, product: string): BillingEvent {
  const matched: Record<string, unknown> = { ...event, userId, product }
  delete matched.customerId
  delete matched.providerId
  return matched as BillingEvent
}

function resolveDriver(
  config: Pick<BillingConfig, 'driver' | 'console' | 'paddle'>,
): BillingDriver {
  if (config.driver === 'console') return createConsoleDriver(config.console)
  if (config.driver === 'paddle') {
    if (!config.paddle) {
      throw new BillingError(
        'billing: driver "paddle" needs the `paddle` options (apiKey, webhookSecret)',
      )
    }
    return createPaddleDriver(config.paddle)
  }
  if (typeof config.driver === 'object' && config.driver !== null) return config.driver
  throw new BillingError(`billing: unknown driver "${String(config.driver)}"`)
}

function requireUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '') {
    throw new BillingError('billing: userId must be a non-empty string')
  }
}
