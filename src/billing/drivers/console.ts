import { BillingWebhookError } from '../errors.js'
import type {
  BillingDriver,
  BillingProductType,
  ConsoleDriverConfig,
  ProviderEvent,
} from '../types.js'

const PARAM = 'console'
const DAY = 86_400_000

type ConsolePayload =
  | {
      action: 'checkout'
      id: string
      at: string
      userId: string
      providerId: string
      type: BillingProductType
      next?: string
    }
  | {
      action: 'cancel'
      id: string
      at: string
      userId: string
      subscriptions: { id: string; providerId: string; accessEndsAt: string }[]
      next?: string
    }

/**
 * A provider that takes no money: for development, before a provider account exists.
 *
 * The checkout URL points at the app's own webhook route. Opening it is the payment: the driver
 * reads the checkout from the query string, the module applies `purchase.completed` or
 * `subscription.started` like a provider's event, and the browser is sent on to `successUrl`.
 * The manage URL works the same way and cancels the user's subscriptions at the end of their
 * period. Reloading either URL delivers the same event id again, which is how a duplicate
 * delivery looks.
 *
 * Nothing is signed and nothing is charged: anyone who can open the URL "buys". Never run it
 * where purchases are worth something.
 */
export function createConsoleDriver(config: ConsoleDriverConfig = {}): BillingDriver {
  const webhookUrl = config.webhookUrl ?? '/billing/webhook'
  const periodDays = config.periodDays ?? 30
  const link = (payload: ConsolePayload): string =>
    `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}${PARAM}=${encode(payload)}`

  return {
    name: 'console',

    async createCheckout(input) {
      const id = `con_${crypto.randomUUID()}`
      console.log(
        `[billing:console] checkout ${id}: ${input.product} (${input.type}) for user ${input.userId}`,
      )
      return {
        id,
        url: link({
          action: 'checkout',
          id,
          at: new Date().toISOString(),
          userId: input.userId,
          providerId: input.providerId,
          type: input.type,
          next: input.successUrl,
        }),
      }
    },

    async parseWebhook(request) {
      if (request.method !== 'GET') {
        throw new BillingWebhookError('the console driver completes checkouts with a GET', 405)
      }
      const url = new URL(request.url)
      const payload = decode(url.searchParams.get(PARAM))
      const occurredAt = new Date(payload.at)
      const events: ProviderEvent[] = []

      if (payload.action === 'checkout') {
        const base = {
          id: `evt_${payload.id}`,
          occurredAt,
          userId: payload.userId,
          customerId: `con_cus_${payload.userId}`,
          providerId: payload.providerId,
        }
        events.push(
          payload.type === 'subscription'
            ? {
                ...base,
                type: 'subscription.started',
                holdingId: `con_sub_${payload.id}`,
                currentPeriodEnd: new Date(occurredAt.getTime() + periodDays * DAY),
              }
            : { ...base, type: 'purchase.completed', holdingId: `con_pur_${payload.id}` },
        )
      } else {
        for (const subscription of payload.subscriptions) {
          events.push({
            id: `evt_${payload.id}_${subscription.id}`,
            type: 'subscription.canceled',
            occurredAt,
            userId: payload.userId,
            providerId: subscription.providerId,
            holdingId: subscription.id,
            accessEndsAt: new Date(subscription.accessEndsAt),
          })
        }
      }

      console.log(
        `[billing:console] ${payload.action} ${payload.id}: ${events.map((event) => event.type).join(', ') || 'nothing to do'}`,
      )
      return { events, response: redirect(payload.next, url) }
    },

    async createManageUrl(input) {
      const now = new Date()
      const subscriptions = input.holdings
        .filter(
          (holding) =>
            holding.type === 'subscription' &&
            (holding.status === 'active' || holding.status === 'past_due'),
        )
        .map((holding) => ({
          id: holding.id,
          providerId: input.providerIds[holding.product] ?? holding.product,
          accessEndsAt: (holding.currentPeriodEnd ?? now).toISOString(),
        }))
      return link({
        action: 'cancel',
        id: `con_${crypto.randomUUID()}`,
        at: now.toISOString(),
        userId: input.userId,
        subscriptions,
        next: input.returnUrl,
      })
    },
  }
}

function encode(payload: ConsolePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function decode(value: string | null): ConsolePayload {
  if (!value) throw new BillingWebhookError(`no "${PARAM}" parameter on the request`)
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
    const json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
    const payload: unknown = JSON.parse(json)
    if (isPayload(payload)) return payload
  } catch {
    // falls through to the error below
  }
  throw new BillingWebhookError(`the "${PARAM}" parameter is not a console checkout`)
}

function isPayload(value: unknown): value is ConsolePayload {
  if (typeof value !== 'object' || value === null) return false
  const payload = value as Record<string, unknown>
  if (
    typeof payload.id !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.at !== 'string' ||
    Number.isNaN(new Date(payload.at).getTime()) ||
    (payload.next !== undefined && typeof payload.next !== 'string')
  ) {
    return false
  }
  if (payload.action === 'checkout') {
    return (
      typeof payload.providerId === 'string' &&
      (payload.type === 'one-time' || payload.type === 'subscription')
    )
  }
  return (
    payload.action === 'cancel' &&
    Array.isArray(payload.subscriptions) &&
    payload.subscriptions.every((subscription: unknown) => {
      if (typeof subscription !== 'object' || subscription === null) return false
      const { id, providerId, accessEndsAt } = subscription as Record<string, unknown>
      return (
        typeof id === 'string' &&
        typeof providerId === 'string' &&
        typeof accessEndsAt === 'string' &&
        !Number.isNaN(new Date(accessEndsAt).getTime())
      )
    })
  )
}

/** Sends the browser on, but only within the app: the URL is unsigned and must not redirect elsewhere. */
function redirect(next: string | undefined, requestUrl: URL): Response {
  if (next !== undefined) {
    try {
      const target = new URL(next, requestUrl)
      if (target.origin === requestUrl.origin) {
        return new Response(null, { status: 303, headers: { Location: target.href } })
      }
    } catch {
      // not a URL: answer without a redirect
    }
  }
  return new Response('Done. The console driver has no page of its own; close this tab.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
