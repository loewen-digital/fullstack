import { applyEvent } from './apply.js'
import { createConsoleDriver } from './drivers/console.js'
import { BillingError, BillingWebhookError } from './errors.js'
import type {
  BillingAccount,
  BillingConfig,
  BillingDriver,
  BillingEvent,
  BillingInstance,
  BillingProducts,
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
  BillingEvent,
  BillingEventDetail,
  BillingEventType,
  BillingHolding,
  BillingHoldingStatus,
  BillingInstance,
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
  ProviderEvent,
} from './types.js'
export { BillingError, BillingWebhookError } from './errors.js'
export { createConsoleDriver } from './drivers/console.js'
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
 *   const checkout = await billing.checkout({ userId, product: 'pro', successUrl: '/account' })
 *   // the webhook route: const { response, events } = await billing.handleWebhook(request)
 *   const { holdings } = await billing.account(userId)
 *
 * A user is a plain string id. Nothing is granted from a browser coming back from the
 * checkout, only from an event the driver verified.
 */
export function createBilling<P extends BillingProducts>(
  config: BillingConfig<P>,
): BillingInstance<keyof P & string> {
  const { store, products } = config
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

  return {
    async checkout(input) {
      const product = products[input.product]
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
          const product = productByProviderId.get(providerEvent.providerId)
          if (product === undefined) {
            result.skipped.push({ reason: 'unknown-product', event: providerEvent })
            continue
          }
          const userId = await userIdOf(providerEvent)
          if (userId === null) {
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

          const event = matchedEvent(providerEvent, userId, product)
          const outcome = await store.transact(userId, (account) => {
            const applied = applyEvent(
              account,
              event,
              products[product]!.type,
              providerEvent.customerId,
            )
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
        // The event that names the user may still be on its way; the provider tries again.
        result.response = json(409, { error: 'no user for this event yet' })
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
  }
}

/** The event as the app sees it: its own user id and product key instead of the provider's ids */
function matchedEvent(event: ProviderEvent, userId: string, product: string): BillingEvent {
  const matched: Record<string, unknown> = { ...event, userId, product }
  delete matched.customerId
  delete matched.providerId
  return matched as BillingEvent
}

function resolveDriver(config: BillingConfig): BillingDriver {
  if (config.driver === 'console') return createConsoleDriver(config.console)
  if (typeof config.driver === 'object' && config.driver !== null) return config.driver
  throw new BillingError(`billing: unknown driver "${String(config.driver)}"`)
}

function requireUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '') {
    throw new BillingError('billing: userId must be a non-empty string')
  }
}
