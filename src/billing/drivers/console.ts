import { BillingError, BillingPurchaseError, BillingWebhookError } from '../errors.js'
import type {
  BillingHoldingStatus,
  BillingProductType,
  ConsoleAction,
  ConsoleDriver,
  ConsoleDriverConfig,
  ProviderEvent,
} from '../types.js'

const PARAM = 'console'
const DAY = 86_400_000
const PURCHASE_ID = /^[\w-]{1,64}$/
const STATUSES: readonly unknown[] = ['active', 'past_due', 'canceled', 'refunded']

/** The actions, and what the page behind the manage link calls them */
const LABEL: Record<ConsoleAction, string> = {
  cancel: 'Cancel at the end of the period',
  'cancel-now': 'End now',
  refund: 'Refund',
}

/** A holding as the manage link carries it: what the user held when the link was made */
interface ManagedHolding {
  id: string
  product: string
  type: BillingProductType
  status: BillingHoldingStatus
  /** Subscriptions: the end of the period that is paid for */
  periodEnd: string | null
  /** Set by a cancel: the moment access ends */
  endsAt: string | null
}

/** What every link carries: an id events are named after, the time of its events, where to go on */
interface PayloadBase {
  id: string
  at: string
  next?: string
}

type ConsolePayload = PayloadBase &
  (
    | { action: 'checkout'; userId: string; providerId: string; type: BillingProductType }
    | { action: 'manage'; userId: string; holdings: ManagedHolding[] }
    | { action: 'cancel'; holdingId: string; accessEndsAt: string }
    | { action: 'cancel-now' | 'refund'; holdingId: string }
  )

type ManagePayload = Extract<ConsolePayload, { action: 'manage' }>

/**
 * A provider that takes no money: for development, before a provider account exists.
 *
 * The checkout URL points at the app's own webhook route. Opening it is the payment: the driver
 * reads the checkout from the query string, the module applies `purchase.completed` or
 * `subscription.started` like a provider's event, and the browser is sent on to `successUrl`.
 *
 * The manage URL leads to a page the driver serves from the same route. It lists what the user
 * held when the link was made, each with a link per action its state allows: cancel a
 * subscription at the end of its period, end it now, refund it or a purchase paid once. Opening
 * such a link is the provider's event (`subscription.canceled`, `payment.refunded`), applied
 * like every other, and the browser is sent on to `returnUrl`. `actionUrl()` makes one of these
 * links without the page, for a test.
 *
 * Reloading any of these URLs delivers the same event id again, which is how a duplicate
 * delivery looks.
 *
 * It also plays a purchase made on the device, for an app that sells through a store: the proof
 * is `{ providerId, id? }`, what the app's client would get from the store, and
 * `billing.verifyPurchase` applies it like a store's. The same `id` handed over again is the
 * same purchase.
 *
 * Nothing is signed and nothing is charged: anyone who can open a URL or post a proof "buys",
 * cancels and refunds. Never run it where purchases are worth something.
 */
export function createConsoleDriver(config: ConsoleDriverConfig = {}): ConsoleDriver {
  const webhookUrl = config.webhookUrl ?? '/billing/webhook'
  const periodDays = config.periodDays ?? 30
  const link = (payload: ConsolePayload): string =>
    `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}${PARAM}=${encode(payload)}`

  /** The link of one action for a holding. `base.id` is the visit or the call the link is from */
  const actionLink: ActionLink = (action, base, holding) =>
    link(
      action === 'cancel'
        ? { ...base, action, holdingId: holding.id, accessEndsAt: holding.periodEnd ?? base.at }
        : { ...base, action, holdingId: holding.id },
    )

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
        throw new BillingWebhookError('the console driver takes its links with a GET', 405)
      }
      const url = new URL(request.url)
      const payload = decode(url.searchParams.get(PARAM))

      if (payload.action === 'manage') {
        console.log(
          `[billing:console] manage ${payload.id}: the page of user ${payload.userId}, nothing changes`,
        )
        return { events: [], response: managePage(payload, url, actionLink) }
      }

      const occurredAt = new Date(payload.at)
      let event: ProviderEvent
      if (payload.action === 'checkout') {
        const base = {
          id: `evt_${payload.id}`,
          occurredAt,
          userId: payload.userId,
          customerId: `con_cus_${payload.userId}`,
          providerId: payload.providerId,
        }
        event =
          payload.type === 'subscription'
            ? {
                ...base,
                type: 'subscription.started',
                holdingId: `con_sub_${payload.id}`,
                currentPeriodEnd: new Date(occurredAt.getTime() + periodDays * DAY),
              }
            : { ...base, type: 'purchase.completed', holdingId: `con_pur_${payload.id}` }
      } else {
        // As a provider's refund does, the event names its holding and nothing else: billing
        // finds the user and the product through the purchase.
        const base = {
          id: `evt_${payload.id}_${payload.action}_${payload.holdingId}`,
          occurredAt,
          holdingId: payload.holdingId,
        }
        event =
          payload.action === 'refund'
            ? { ...base, type: 'payment.refunded' }
            : {
                ...base,
                type: 'subscription.canceled',
                accessEndsAt:
                  payload.action === 'cancel' ? new Date(payload.accessEndsAt) : occurredAt,
              }
      }

      console.log(`[billing:console] ${payload.action} ${payload.id}: ${event.type}`)
      return { events: [event], response: redirect(payload.next, url) }
    },

    async verifyPurchase(input) {
      const proof = input.proof
      if (
        typeof proof !== 'object' ||
        proof === null ||
        !('providerId' in proof) ||
        typeof proof.providerId !== 'string' ||
        proof.providerId === ''
      ) {
        throw new BillingPurchaseError(
          'the proof is not a console purchase: it needs the `providerId` of what was bought',
        )
      }
      const given = 'id' in proof ? proof.id : undefined
      if (given !== undefined && (typeof given !== 'string' || !PURCHASE_ID.test(given))) {
        throw new BillingPurchaseError(
          'the `id` of a console purchase is 1 to 64 letters, digits, "_" or "-"',
        )
      }
      // What the device would call the purchase: the same id again is the same purchase.
      const id = given ?? crypto.randomUUID()
      const { providerId } = proof
      const type = Object.hasOwn(input.products, providerId)
        ? input.products[providerId]!.type
        : 'one-time'
      const occurredAt = new Date()
      const base = {
        id: `evt_${id}`,
        occurredAt,
        userId: input.userId,
        customerId: `con_cus_${input.userId}`,
        providerId,
      }
      const event: ProviderEvent =
        type === 'subscription'
          ? {
              ...base,
              type: 'subscription.started',
              holdingId: `con_sub_${id}`,
              currentPeriodEnd: new Date(occurredAt.getTime() + periodDays * DAY),
            }
          : { ...base, type: 'purchase.completed', holdingId: `con_pur_${id}` }

      console.log(
        `[billing:console] purchase ${id} from the device: ${event.type} for user ${input.userId}`,
      )
      return { events: [event] }
    },

    async createManageUrl(input) {
      const now = new Date()
      const holdings = input.holdings
        .map((holding): ManagedHolding => ({
          id: holding.id,
          product: holding.product,
          type: holding.type,
          status: holding.status,
          periodEnd: holding.currentPeriodEnd?.toISOString() ?? null,
          endsAt: holding.accessEndsAt?.toISOString() ?? null,
        }))
        .filter((holding) => actionsFor(holding, now.getTime()).length > 0)
      // Nothing to manage: the user holds nothing here, or all of it was refunded.
      if (holdings.length === 0) return null
      return link({
        action: 'manage',
        id: `con_${crypto.randomUUID()}`,
        at: now.toISOString(),
        userId: input.userId,
        holdings,
        next: input.returnUrl,
      })
    },

    actionUrl(holding, action, options = {}) {
      if (!Object.hasOwn(LABEL, action)) {
        throw new BillingError(
          `billing: the console driver plays "cancel", "cancel-now" and "refund", not "${String(action)}".`,
        )
      }
      if (typeof holding.id !== 'string' || holding.id === '') {
        throw new BillingError('billing: the holding of a console action has no id.')
      }
      if (action !== 'refund' && holding.type !== 'subscription') {
        throw new BillingError(
          `billing: "${action}" ends a subscription. A purchase paid once can only be refunded.`,
        )
      }
      return actionLink(
        action,
        {
          id: `con_${crypto.randomUUID()}`,
          at: new Date().toISOString(),
          next: options.returnUrl,
        },
        { id: holding.id, periodEnd: holding.currentPeriodEnd?.toISOString() ?? null },
      )
    },
  }
}

type ActionLink = (
  action: ConsoleAction,
  base: PayloadBase,
  holding: Pick<ManagedHolding, 'id' | 'periodEnd'>,
) => string

/**
 * What can be played for a holding at `now`. Nothing for one that was refunded; a subscription
 * that is canceled can still end earlier, for as long as it runs.
 */
function actionsFor(
  holding: Pick<ManagedHolding, 'type' | 'status' | 'endsAt'>,
  now: number,
): ConsoleAction[] {
  if (holding.status === 'refunded') return []
  if (holding.type !== 'subscription') return ['refund']
  if (holding.status !== 'canceled') return ['cancel', 'cancel-now', 'refund']
  const runs = holding.endsAt !== null && now < new Date(holding.endsAt).getTime()
  return runs ? ['cancel-now', 'refund'] : ['refund']
}

/** A holding's state in words, at `now` */
function stateOf(holding: ManagedHolding, now: number): string {
  const kind = holding.type === 'subscription' ? 'subscription' : 'paid once'
  switch (holding.status) {
    case 'active':
      return holding.periodEnd === null
        ? `${kind}, active`
        : `${kind}, active, paid until ${iso(holding.periodEnd)}`
    case 'past_due':
      return `${kind}, past due`
    case 'canceled': {
      if (holding.endsAt === null) return `${kind}, canceled`
      const runs = now < new Date(holding.endsAt).getTime()
      return `${kind}, canceled, ${runs ? 'ends' : 'ended'} ${iso(holding.endsAt)}`
    }
    case 'refunded':
      return `${kind}, refunded`
  }
}

/**
 * The page behind the manage link: what the link says the user holds, and a link per action.
 * It is made from the link alone, so opening it changes nothing and reloading it shows the same
 * links, with the same event ids.
 */
function managePage(payload: ManagePayload, requestUrl: URL, actionLink: ActionLink): Response {
  const now = new Date(payload.at).getTime()
  const base: PayloadBase = { id: payload.id, at: payload.at, next: payload.next }
  const items = payload.holdings.map((holding) => {
    const links = actionsFor(holding, now)
      .map(
        (action) =>
          `<li><a href="${html(actionLink(action, base, holding))}">${LABEL[action]}</a></li>`,
      )
      .join('')
    return `<li><strong>${html(holding.product)}</strong>: ${html(stateOf(holding, now))}<br><code>${html(holding.id)}</code><ul>${links}</ul></li>`
  })
  const back = within(payload.next, requestUrl)

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Console billing</title>
<style>
body { font: 1rem/1.5 system-ui, sans-serif; max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem; }
li { margin: 0.25rem 0; }
code { overflow-wrap: anywhere; }
a { display: inline-block; padding: 0.625rem 0; }
</style>
</head>
<body>
<h1>Console billing</h1>
<p>What user <code>${html(payload.userId)}</code> held on ${iso(payload.at)}. A link plays what a provider would report, and counts once. Nothing is charged and nothing is paid back.</p>
${items.length > 0 ? `<ul>${items.join('')}</ul>` : '<p>Nothing to manage.</p>'}
${back ? `<p><a href="${html(back.href)}">Back to the app</a></p>` : ''}
</body>
</html>
`
  return new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The page shows what an unsigned link says. Everything in it is escaped, and should
      // something slip through, nothing of it runs or loads.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}

/** Text as it may stand in HTML, between tags and inside a quoted attribute */
function html(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** A date of a link, written out again: what the page shows is never the link's own text */
function iso(value: string): string {
  return new Date(value).toISOString()
}

function encode(payload: ConsolePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
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
  throw new BillingWebhookError(`the "${PARAM}" parameter is not a link of the console driver`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime())

const isId = (value: unknown): value is string => typeof value === 'string' && value !== ''

const isType = (value: unknown): value is BillingProductType =>
  value === 'one-time' || value === 'subscription'

function isManagedHolding(value: unknown): value is ManagedHolding {
  return (
    isRecord(value) &&
    isId(value.id) &&
    typeof value.product === 'string' &&
    isType(value.type) &&
    STATUSES.includes(value.status) &&
    (value.periodEnd === null || isDate(value.periodEnd)) &&
    (value.endsAt === null || isDate(value.endsAt))
  )
}

function isPayload(value: unknown): value is ConsolePayload {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isDate(value.at) ||
    (value.next !== undefined && typeof value.next !== 'string')
  ) {
    return false
  }
  switch (value.action) {
    case 'checkout':
      return (
        typeof value.userId === 'string' &&
        typeof value.providerId === 'string' &&
        isType(value.type)
      )
    case 'manage':
      return (
        typeof value.userId === 'string' &&
        Array.isArray(value.holdings) &&
        value.holdings.every(isManagedHolding)
      )
    case 'cancel':
      return isId(value.holdingId) && isDate(value.accessEndsAt)
    case 'cancel-now':
    case 'refund':
      return isId(value.holdingId)
    default:
      return false
  }
}

/**
 * `next` as a page of the app itself, or `null`: a link is unsigned and must lead nowhere else,
 * neither as a redirect nor as a link on the page.
 */
function within(next: string | undefined, requestUrl: URL): URL | null {
  if (next === undefined) return null
  try {
    const target = new URL(next, requestUrl)
    const web = target.protocol === 'http:' || target.protocol === 'https:'
    return web && target.origin === requestUrl.origin ? target : null
  } catch {
    return null
  }
}

/** Sends the browser on, but only within the app */
function redirect(next: string | undefined, requestUrl: URL): Response {
  const target = within(next, requestUrl)
  if (target) return new Response(null, { status: 303, headers: { Location: target.href } })
  return new Response('Done. There is nowhere to send you on to: close this tab.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
