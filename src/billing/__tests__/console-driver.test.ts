import { afterEach, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import {
  BillingError,
  BillingPurchaseError,
  createBilling,
  createConsoleDriver,
  createMemoryBillingStore,
} from '../index.js'
import type { BillingHolding, ConsoleAction } from '../index.js'

const ORIGIN = 'https://app.example'
const DAY = 86_400_000
const HOOK = '/api/billing/webhook'

const products = {
  unlock: { type: 'one-time', providerId: 'pri_unlock', features: ['themes'] },
  pro: { type: 'subscription', providerId: 'pri_pro', features: ['export'] },
} as const

function setup() {
  const driver = createConsoleDriver({ webhookUrl: HOOK })
  const billing = createBilling({ driver, store: createMemoryBillingStore(), products })
  return { driver, billing }
}

type Billing = ReturnType<typeof setup>['billing']

const open = (url: string | null, method = 'GET'): Request =>
  new Request(new URL(url ?? '', ORIGIN), { method })

const minute = (count: number): Date => new Date(Date.UTC(2026, 10, 17, 12, count))

/** A link as the driver writes one, with a payload of the test's own */
function linkOf(payload: unknown, hook = HOOK): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const base64 = btoa(String.fromCharCode(...bytes))
  return `${hook}?console=${base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`
}

const unescaped = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

/** What the page behind a manage link shows: each holding with its state and its links by text */
function managed(page: string) {
  const items = page.matchAll(
    /<li><strong>(.*?)<\/strong>: (.*?)<br><code>(.*?)<\/code><ul>(.*?)<\/ul><\/li>/g,
  )
  return [...items].map(([, product, state, id, links]) => ({
    product: unescaped(product!),
    state: unescaped(state!),
    id: unescaped(id!),
    links: Object.fromEntries(
      [...links!.matchAll(/<li><a href="([^"]*)">([^<]*)<\/a><\/li>/g)].map(([, href, text]) => [
        text!,
        unescaped(href!),
      ]),
    ),
  }))
}

/** Opens the manage link of a user and reads the page */
async function manage(billing: Billing, userId: string, returnUrl?: string) {
  const { response } = await billing.handleWebhook(
    open(await billing.manageUrl(userId, { returnUrl })),
  )
  return managed(await response.text())
}

async function buy(billing: Billing, userId: string, product: keyof typeof products) {
  await billing.handleWebhook(open((await billing.checkout({ userId, product })).url))
  return (await billing.account(userId)).holdings.at(-1)!
}

describe('console billing driver', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('completes a one-time checkout when its URL is opened', async () => {
    const { billing } = setup()

    const checkout = await billing.checkout({
      userId: 'u1',
      product: 'unlock',
      successUrl: '/thanks',
    })
    expect(checkout.url).toMatch(/^\/api\/billing\/webhook\?console=[\w-]+$/)
    expect((await billing.account('u1')).holdings).toEqual([])

    const { response, events } = await billing.handleWebhook(open(checkout.url))

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/thanks`)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'purchase.completed', userId: 'u1', product: 'unlock' })
    expect(await billing.account('u1')).toMatchObject({
      customers: { console: 'con_cus_u1' },
      holdings: [{ provider: 'console', product: 'unlock', type: 'one-time', status: 'active' }],
    })
  })

  it('applies a checkout once when its URL is opened again', async () => {
    const { billing } = setup()
    const checkout = await billing.checkout({ userId: 'u1', product: 'unlock' })

    await billing.handleWebhook(open(checkout.url))
    const again = await billing.handleWebhook(open(checkout.url))

    expect(again.response.status).toBe(200)
    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('starts a subscription with a period', async () => {
    const { billing } = setup()

    const subscription = await buy(billing, 'u1', 'pro')

    expect(subscription).toMatchObject({ product: 'pro', type: 'subscription', status: 'active' })
    expect(subscription.currentPeriodEnd!.getTime() - subscription.startedAt.getTime()).toBe(
      30 * DAY,
    )
  })

  describe('the page behind the manage link', () => {
    it('shows what the user holds and changes nothing', async () => {
      const { billing } = setup()
      const purchase = await buy(billing, 'u1', 'unlock')
      const subscription = await buy(billing, 'u1', 'pro')
      const before = await billing.account('u1')

      const url = await billing.manageUrl('u1', { returnUrl: '/account' })
      expect(url).toMatch(/^\/api\/billing\/webhook\?console=[\w-]+$/)
      const { response, events, skipped } = await billing.handleWebhook(open(url))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(events).toEqual([])
      expect(skipped).toEqual([])
      expect(await billing.account('u1')).toEqual(before)

      const page = await response.text()
      expect(page).toContain('<code>u1</code>')
      expect(page).toContain(`<a href="${ORIGIN}/account">Back to the app</a>`)
      expect(managed(page)).toEqual([
        {
          product: 'unlock',
          state: 'paid once, active',
          id: purchase.id,
          links: { Refund: expect.stringMatching(/^\/api\/billing\/webhook\?console=[\w-]+$/) },
        },
        {
          product: 'pro',
          state: `subscription, active, paid until ${subscription.currentPeriodEnd!.toISOString()}`,
          id: subscription.id,
          links: {
            'Cancel at the end of the period': expect.any(String),
            'End now': expect.any(String),
            Refund: expect.any(String),
          },
        },
      ])
    })

    it('runs and loads nothing', async () => {
      const { billing } = setup()
      await buy(billing, 'u1', 'unlock')

      const { response } = await billing.handleWebhook(open(await billing.manageUrl('u1')))

      const policy = response.headers.get('Content-Security-Policy')!
      expect(policy).toContain("default-src 'none'")
      expect(policy).not.toContain('script-src')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.text()).not.toContain('<script')
    })

    it('offers each holding what its state allows, and leaves out what was refunded', async () => {
      const driver = createConsoleDriver({ webhookUrl: HOOK })
      const now = Date.now()
      const holding = (id: string, change: Partial<BillingHolding>): BillingHolding => ({
        provider: 'console',
        id,
        product: 'pro',
        type: 'subscription',
        status: 'active',
        startedAt: new Date(now - 40 * DAY),
        currentPeriodEnd: new Date(now + 20 * DAY),
        accessEndsAt: null,
        pastDueSince: null,
        updatedAt: new Date(now - 10 * DAY),
        ...change,
      })
      const once = { product: 'unlock', type: 'one-time', currentPeriodEnd: null } as const
      const soon = new Date(now + 20 * DAY)
      const over = new Date(now - DAY)

      const url = await driver.createManageUrl({
        userId: 'u1',
        customerId: 'con_cus_u1',
        providerIds: { pro: 'pri_pro', unlock: 'pri_unlock' },
        holdings: [
          holding('runs', {}),
          holding('unpaid', { status: 'past_due', pastDueSince: over }),
          holding('ending', { status: 'canceled', accessEndsAt: soon }),
          holding('ended', { status: 'canceled', accessEndsAt: over }),
          holding('open-end', { currentPeriodEnd: null }),
          holding('paid-back', { status: 'refunded', accessEndsAt: over }),
          holding('bought', once),
          holding('returned', { ...once, status: 'refunded', accessEndsAt: over }),
        ],
      })
      const { response } = await driver.parseWebhook(open(url))
      const shown = managed(await response!.text())

      expect(shown.map((item) => [item.id, item.state, Object.keys(item.links)])).toEqual([
        [
          'runs',
          `subscription, active, paid until ${soon.toISOString()}`,
          ['Cancel at the end of the period', 'End now', 'Refund'],
        ],
        [
          'unpaid',
          'subscription, past due',
          ['Cancel at the end of the period', 'End now', 'Refund'],
        ],
        ['ending', `subscription, canceled, ends ${soon.toISOString()}`, ['End now', 'Refund']],
        ['ended', `subscription, canceled, ended ${over.toISOString()}`, ['Refund']],
        [
          'open-end',
          'subscription, active',
          ['Cancel at the end of the period', 'End now', 'Refund'],
        ],
        ['bought', 'paid once, active', ['Refund']],
      ])
    })

    it('is not there for a user with nothing to manage', async () => {
      const { billing } = setup()
      expect(await billing.manageUrl('nobody')).toBeNull()

      const purchase = await buy(billing, 'u1', 'unlock')
      expect(await billing.manageUrl('u1')).not.toBeNull()

      const [item] = await manage(billing, 'u1')
      await billing.handleWebhook(open(item!.links.Refund!))
      expect((await billing.account('u1')).holdings).toMatchObject([
        { id: purchase.id, status: 'refunded' },
      ])
      expect(await billing.manageUrl('u1')).toBeNull()
    })

    it('shows the same links when it is opened again, however much later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(minute(0))
      const { billing } = setup()
      await buy(billing, 'u1', 'pro')
      const url = await billing.manageUrl('u1')

      const first = await (await billing.handleWebhook(open(url))).response.text()
      // Past the end of the period: the page is the link, not the present.
      vi.setSystemTime(new Date(minute(0).getTime() + 40 * DAY))
      const again = await (await billing.handleWebhook(open(url))).response.text()

      expect(again).toBe(first)
      expect(managed(first)[0]!.state).toMatch(/^subscription, active, paid until /)
    })

    it('is a visit of its own with each manage link, also in the same instant', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(minute(0))
      const { billing } = setup()
      await buy(billing, 'u1', 'pro')

      const [one, other] = [await billing.manageUrl('u1'), await billing.manageUrl('u1')]
      expect(other).not.toBe(one)
      const refunds = []
      for (const url of [one, other]) {
        const [item] = managed(await (await billing.handleWebhook(open(url))).response.text())
        refunds.push(await billing.handleWebhook(open(item!.links.Refund!)))
      }

      // The second visit's refund is an event of its own: one the holding has already, not one
      // that was delivered before.
      expect(refunds[0]!.events).toHaveLength(1)
      expect(refunds[1]!.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    })

    it('escapes what the link says, and leads nowhere but into the app', async () => {
      const { driver } = setup()
      const attack = '<script>alert(1)</script>'
      const holding = {
        id: `"><img src=x onerror=alert(1)>`,
        product: attack,
        type: 'subscription',
        status: 'canceled',
        periodEnd: '1 Jan 2026 00:00 GMT (<b>period</b>)',
        endsAt: '1 Feb 2026 00:00 GMT (<b>end</b>)',
      }

      for (const next of ['javascript:alert(1)', 'https://elsewhere.example/phish', 'data:x', '']) {
        const { response, events } = await driver.parseWebhook(
          open(
            linkOf({
              action: 'manage',
              id: `con_'"<i>`,
              at: '1 Jan 2026 00:00 GMT (<b>at</b>)',
              userId: `${attack}'&"`,
              holdings: [holding],
              ...(next === '' ? {} : { next }),
            }),
          ),
        )
        const page = await response!.text()

        expect(events).toEqual([])
        expect(page).not.toMatch(/<(script|img|b|i)\b/)
        expect(page).not.toContain('Back to the app')
        expect(page).not.toContain('javascript:')
        expect(page).not.toContain('elsewhere.example')
        expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&#39;&amp;&quot;')
        expect(page).toContain('held on 2026-01-01T00:00:00.000Z.')
        expect(managed(page)).toEqual([
          {
            product: attack,
            state: 'subscription, canceled, ends 2026-02-01T00:00:00.000Z',
            id: holding.id,
            links: { 'End now': expect.any(String), Refund: expect.any(String) },
          },
        ])
      }
    })

    it('takes no script for a way back, wherever the page is served from', async () => {
      const { driver } = setup()
      const link = linkOf({
        action: 'manage',
        id: 'con_1',
        at: '2026-01-01',
        userId: 'u1',
        holdings: [],
        next: 'javascript:alert(1)',
      })

      // An address without an origin has the same origin as a script, "null".
      for (const address of [`file://${link}`, `app://host${link}`]) {
        const { response } = await driver.parseWebhook(new Request(address))
        const page = await response!.text()

        expect(page).toContain('Nothing to manage.')
        expect(page).not.toContain('javascript:')
        expect(page).not.toContain('Back to the app')
      }
    })

    it('says so when a link names nothing to manage', async () => {
      const { driver } = setup()

      const { response } = await driver.parseWebhook(
        open(
          linkOf({ action: 'manage', id: 'con_1', at: '2026-01-01', userId: 'u1', holdings: [] }),
        ),
      )

      const page = await response!.text()
      expect(page).toContain('Nothing to manage.')
      expect(managed(page)).toEqual([])
    })
  })

  describe('the actions of the page', () => {
    it('cancels a subscription at the end of its period', async () => {
      const { billing } = setup()
      const subscription = await buy(billing, 'u1', 'pro')
      const [item] = await manage(billing, 'u1', '/account')

      const { response, events } = await billing.handleWebhook(
        open(item!.links['Cancel at the end of the period']!),
      )

      expect(response.status).toBe(303)
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/account`)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'subscription.canceled',
        provider: 'console',
        userId: 'u1',
        product: 'pro',
        holdingId: subscription.id,
        accessEndsAt: subscription.currentPeriodEnd,
      })
      expect((await billing.account('u1')).holdings[0]).toMatchObject({
        status: 'canceled',
        accessEndsAt: subscription.currentPeriodEnd,
      })
      const end = subscription.currentPeriodEnd!
      expect(
        (await billing.entitlements('u1', { now: new Date(end.getTime() - 1) })).has('export'),
      ).toBe(true)
      expect((await billing.entitlements('u1', { now: end })).has('export')).toBe(false)
    })

    it('ends a subscription now', async () => {
      const { billing } = setup()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(minute(0))
      const subscription = await buy(billing, 'u1', 'pro')
      expect((await billing.entitlements('u1')).has('export')).toBe(true)
      vi.setSystemTime(minute(1))
      const url = await billing.manageUrl('u1', { returnUrl: '/account' })
      vi.setSystemTime(minute(2))
      const [item] = managed(await (await billing.handleWebhook(open(url))).response.text())
      vi.setSystemTime(minute(3))

      const { response, events } = await billing.handleWebhook(open(item!.links['End now']!))

      expect(response.headers.get('Location')).toBe(`${ORIGIN}/account`)
      expect(events).toHaveLength(1)
      const [event] = events
      expect(event).toMatchObject({ type: 'subscription.canceled', holdingId: subscription.id })
      // Not the end of the period: the moment of the event, which is when the app asked for the
      // manage link, not when the page or the link was opened.
      expect(event).toMatchObject({ occurredAt: minute(1), accessEndsAt: minute(1) })
      expect((await billing.account('u1')).holdings[0]).toMatchObject({
        status: 'canceled',
        accessEndsAt: event!.occurredAt,
        // What was paid for stays on the record.
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
      expect((await billing.entitlements('u1')).has('export')).toBe(false)
    })

    it('ends earlier what was canceled for the end of its period', async () => {
      const { billing } = setup()
      const subscription = await buy(billing, 'u1', 'pro')
      const [first] = await manage(billing, 'u1')
      await billing.handleWebhook(open(first!.links['Cancel at the end of the period']!))
      expect((await billing.entitlements('u1')).has('export')).toBe(true)

      const [second] = await manage(billing, 'u1')
      expect(Object.keys(second!.links)).toEqual(['End now', 'Refund'])
      expect(second!.state).toBe(
        `subscription, canceled, ends ${subscription.currentPeriodEnd!.toISOString()}`,
      )
      const { events } = await billing.handleWebhook(open(second!.links['End now']!))

      expect(events.map((event) => event.type)).toEqual(['subscription.canceled'])
      expect((await billing.entitlements('u1')).has('export')).toBe(false)
    })

    it('refunds a purchase paid once', async () => {
      const { billing } = setup()
      const purchase = await buy(billing, 'u1', 'unlock')
      expect((await billing.entitlements('u1')).has('themes')).toBe(true)
      const [item] = await manage(billing, 'u1', '/account')

      const { response, events } = await billing.handleWebhook(open(item!.links.Refund!))

      expect(response.status).toBe(303)
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/account`)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'payment.refunded',
        provider: 'console',
        userId: 'u1',
        product: 'unlock',
        holdingId: purchase.id,
      })
      expect((await billing.account('u1')).holdings).toMatchObject([
        { id: purchase.id, type: 'one-time', status: 'refunded' },
      ])
      expect((await billing.entitlements('u1')).has('themes')).toBe(false)
    })

    it('refunds a subscription, and only the one that was asked for', async () => {
      const { billing } = setup()
      const purchase = await buy(billing, 'u1', 'unlock')
      const subscription = await buy(billing, 'u1', 'pro')
      const other = await buy(billing, 'u2', 'pro')
      const items = await manage(billing, 'u1')

      const { events } = await billing.handleWebhook(
        open(items.find((item) => item.id === subscription.id)!.links.Refund!),
      )

      expect(events).toMatchObject([{ type: 'payment.refunded', holdingId: subscription.id }])
      expect((await billing.account('u1')).holdings).toMatchObject([
        { id: purchase.id, status: 'active' },
        { id: subscription.id, status: 'refunded' },
      ])
      expect((await billing.account('u2')).holdings).toMatchObject([
        { id: other.id, status: 'active' },
      ])
      expect((await billing.entitlements('u1')).features).toEqual(['themes'])
    })

    it('applies an action once, however often its link is opened', async () => {
      const { billing } = setup()
      await buy(billing, 'u1', 'pro')
      const url = await billing.manageUrl('u1')
      const [item] = managed(await (await billing.handleWebhook(open(url))).response.text())

      const first = await billing.handleWebhook(open(item!.links['End now']!))
      const state = await billing.account('u1')
      const again = await billing.handleWebhook(open(item!.links['End now']!))
      // The page opened again has the link of the same event.
      const [reloaded] = managed(await (await billing.handleWebhook(open(url))).response.text())
      const fromReload = await billing.handleWebhook(open(reloaded!.links['End now']!))

      expect(first.events).toHaveLength(1)
      for (const repeated of [again, fromReload]) {
        expect(repeated.response.status).toBe(200)
        expect(repeated.events).toEqual([])
        expect(repeated.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
      }
      expect(await billing.account('u1')).toEqual(state)
    })

    it('counts each action of a page as an event of its own', async () => {
      const { billing } = setup()
      await buy(billing, 'u1', 'unlock')
      await buy(billing, 'u1', 'pro')
      const [purchase, subscription] = await manage(billing, 'u1')

      const ids = []
      for (const url of [
        subscription!.links['Cancel at the end of the period']!,
        subscription!.links['End now']!,
        subscription!.links.Refund!,
        purchase!.links.Refund!,
      ]) {
        const { events } = await billing.handleWebhook(open(url))
        expect(events).toHaveLength(1)
        ids.push(events[0]!.id)
      }

      expect(new Set(ids).size).toBe(4)
      expect((await billing.account('u1')).holdings.map((holding) => holding.status)).toEqual([
        'refunded',
        'refunded',
      ])
    })
  })

  describe('actionUrl', () => {
    it('makes the link of each action without the page', async () => {
      const { driver, billing } = setup()
      const subscription = await buy(billing, 'u1', 'pro')
      const purchase = await buy(billing, 'u1', 'unlock')

      const cancel = driver.actionUrl(subscription, 'cancel')
      expect(cancel).toMatch(/^\/api\/billing\/webhook\?console=[\w-]+$/)
      const canceled = await billing.handleWebhook(open(cancel))
      expect(canceled.response.status).toBe(200)
      expect(canceled.response.headers.get('Location')).toBeNull()
      expect(canceled.events).toMatchObject([
        {
          type: 'subscription.canceled',
          userId: 'u1',
          product: 'pro',
          holdingId: subscription.id,
          accessEndsAt: subscription.currentPeriodEnd,
        },
      ])

      const ended = await billing.handleWebhook(
        open(driver.actionUrl(subscription, 'cancel-now', { returnUrl: '/account' })),
      )
      expect(ended.response.headers.get('Location')).toBe(`${ORIGIN}/account`)
      expect(ended.events).toHaveLength(1)
      expect(ended.events[0]).toMatchObject({
        type: 'subscription.canceled',
        accessEndsAt: ended.events[0]!.occurredAt,
      })
      expect((await billing.entitlements('u1')).has('export')).toBe(false)

      const refunded = await billing.handleWebhook(open(driver.actionUrl(purchase, 'refund')))
      expect(refunded.events).toMatchObject([
        { type: 'payment.refunded', userId: 'u1', product: 'unlock', holdingId: purchase.id },
      ])
      expect((await billing.account('u1')).holdings.map((holding) => holding.status)).toEqual([
        'canceled',
        'refunded',
      ])
    })

    it('makes an event of its own with each call, and the same one with each opening', async () => {
      const { driver, billing } = setup()
      const purchase = await buy(billing, 'u1', 'unlock')
      const url = driver.actionUrl(purchase, 'refund')

      const first = await billing.handleWebhook(open(url))
      const again = await billing.handleWebhook(open(url))
      // The provider reports the same refund with a second event: the holding has it already.
      const second = await billing.handleWebhook(open(driver.actionUrl(purchase, 'refund')))

      expect(first.events).toHaveLength(1)
      expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
      expect(second.events).toEqual([])
      expect(second.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    })

    it('cancels a subscription without a period at the time of the call', async () => {
      const { driver, billing } = setup()
      const subscription = await buy(billing, 'u1', 'pro')

      const { events } = await billing.handleWebhook(
        open(driver.actionUrl({ ...subscription, currentPeriodEnd: null }, 'cancel')),
      )

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ accessEndsAt: events[0]!.occurredAt })
    })

    it('refuses an action that does not fit', async () => {
      const { driver, billing } = setup()
      const purchase = await buy(billing, 'u1', 'unlock')
      const subscription = await buy(billing, 'u1', 'pro')

      expect(() => driver.actionUrl(purchase, 'cancel')).toThrow(BillingError)
      expect(() => driver.actionUrl(purchase, 'cancel-now')).toThrow(/paid once/)
      // For a subscription too, which every action there is fits.
      for (const holding of [purchase, subscription]) {
        expect(() => driver.actionUrl(holding, 'renew' as ConsoleAction)).toThrow(/not "renew"/)
        // Also the name of something every object has: it is no action.
        expect(() => driver.actionUrl(holding, 'constructor' as ConsoleAction)).toThrow(
          BillingError,
        )
        expect(() => driver.actionUrl({ ...holding, id: '' }, 'refund')).toThrow(/no id/)
      }
    })

    it('waits with 409 for a holding nobody bought, and for one whose user was forgotten', async () => {
      const { driver, billing } = setup()
      const never = { id: 'con_pur_never', type: 'one-time', currentPeriodEnd: null } as const

      const unknown = await billing.handleWebhook(open(driver.actionUrl(never, 'refund')))
      expect(unknown.response.status).toBe(409)
      expect(unknown.events).toEqual([])
      expect(unknown.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])

      const subscription = await buy(billing, 'u1', 'pro')
      await billing.forget('u1')
      const forgotten = await billing.handleWebhook(
        open(driver.actionUrl(subscription, 'cancel-now', { returnUrl: '/account' })),
      )
      expect(forgotten.response.status).toBe(409)
      expect(forgotten.response.headers.get('Location')).toBeNull()
      expect((await billing.account('u1')).holdings).toEqual([])
    })
  })

  it('plays a provider under another name, each with its own route', async () => {
    const web = createConsoleDriver({ webhookUrl: '/hooks/web' })
    const app = createConsoleDriver({ webhookUrl: '/hooks/app' })
    const billing = createBilling({
      drivers: { web, app },
      store: createMemoryBillingStore(),
      products: {
        pro: { type: 'subscription', providerId: { web: 'pri_pro', app: 'com.app.pro' } },
      },
    })
    for (const provider of ['web', 'app'] as const) {
      const checkout = await billing.checkout({ userId: 'u1', product: 'pro', provider })
      await billing.handleWebhook(open(checkout.url), { provider })
    }
    const [onWeb, inApp] = (await billing.account('u1')).holdings

    const url = await billing.manageUrl('u1', { provider: 'app' })
    expect(url).toMatch(/^\/hooks\/app\?console=/)
    const page = await billing.handleWebhook(open(url), { provider: 'app' })
    const shown = managed(await page.response.text())
    expect(shown.map((item) => item.id)).toEqual([inApp!.id])
    expect(shown[0]!.links.Refund).toMatch(/^\/hooks\/app\?console=/)

    // A link of the app's purchase finds nothing at the other provider.
    const elsewhere = await billing.handleWebhook(open(shown[0]!.links.Refund!), {
      provider: 'web',
    })
    expect(elsewhere.response.status).toBe(409)

    const { events } = await billing.handleWebhook(open(shown[0]!.links.Refund!), {
      provider: 'app',
    })
    expect(events).toMatchObject([
      { type: 'payment.refunded', provider: 'app', holdingId: inApp!.id },
    ])
    expect((await billing.account('u1')).holdings).toMatchObject([
      { provider: 'web', id: onWeb!.id, status: 'active' },
      { provider: 'app', id: inApp!.id, status: 'refunded' },
    ])
  })

  it('answers without a redirect when there is nowhere to go, or the target is another site', async () => {
    const { driver, billing } = setup()

    const plain = await billing.checkout({ userId: 'u1', product: 'unlock' })
    const first = await billing.handleWebhook(open(plain.url))
    expect(first.response.status).toBe(200)
    expect(first.response.headers.get('Location')).toBeNull()

    const foreign = await billing.checkout({
      userId: 'u2',
      product: 'unlock',
      successUrl: 'https://elsewhere.example/phish',
    })
    const second = await billing.handleWebhook(open(foreign.url))
    expect(second.response.status).toBe(200)
    expect(second.response.headers.get('Location')).toBeNull()
    expect(second.events).toHaveLength(1)

    const [purchase] = (await billing.account('u2')).holdings
    for (const returnUrl of ['https://elsewhere.example/phish', 'javascript:alert(1)']) {
      const third = await billing.handleWebhook(
        open(driver.actionUrl(purchase!, 'refund', { returnUrl })),
      )
      expect(third.response.status).toBe(200)
      expect(third.response.headers.get('Location')).toBeNull()
    }
  })

  it('rejects a POST, a missing parameter and a parameter that is no link of the driver', async () => {
    const { billing } = setup()
    const checkout = await billing.checkout({ userId: 'u1', product: 'unlock' })
    const purchase = await buy(billing, 'u2', 'unlock')
    const at = '2026-11-17T12:00:00.000Z'
    const holding = {
      id: purchase.id,
      product: 'unlock',
      type: 'one-time',
      status: 'active',
      periodEnd: null,
      endsAt: null,
    }

    expect((await billing.handleWebhook(open(checkout.url, 'POST'))).response.status).toBe(405)
    expect((await billing.handleWebhook(open(HOOK))).response.status).toBe(400)
    expect((await billing.handleWebhook(open(`${HOOK}?console=bm90LWpzb24`))).response.status).toBe(
      400,
    )

    const none: unknown[] = [
      null,
      'refund',
      { id: 1 },
      { action: 'checkout', id: 'c1', at, userId: 'u1', providerId: 'pri_unlock', type: 'gift' },
      {
        action: 'checkout',
        id: 'c1',
        at: 'soon',
        userId: 'u1',
        providerId: 'pri_unlock',
        type: 'one-time',
      },
      { action: 'refund', id: 'r1', at },
      { action: 'refund', id: 'r1', at, holdingId: '' },
      { action: 'refund', id: 'r1', at, holdingId: 7 },
      { action: 'refund', id: 'r1', holdingId: purchase.id },
      { action: 'refund', id: 'r1', at, holdingId: purchase.id, next: 7 },
      { action: 'renew', id: 'r1', at, holdingId: purchase.id },
      { action: 'constructor', id: 'r1', at, holdingId: purchase.id },
      { action: 'cancel', id: 'r1', at, holdingId: purchase.id },
      { action: 'cancel', id: 'r1', at, holdingId: purchase.id, accessEndsAt: 'never' },
      { action: 'cancel-now', id: 'r1', at },
      { action: 'manage', id: 'm1', at, userId: 'u2' },
      { action: 'manage', id: 'm1', at, holdings: [holding] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [null] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, id: '' }] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, product: 7 }] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, type: 'gift' }] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, status: 'paid' }] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, periodEnd: 'x' }] },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [{ ...holding, endsAt: 7 }] },
      // The link that canceled on opening, up to 0.8.
      {
        action: 'cancel',
        id: 'c1',
        at,
        userId: 'u2',
        subscriptions: [{ id: purchase.id, providerId: 'pri_unlock', accessEndsAt: at }],
      },
    ]
    for (const payload of none) {
      const { response, events } = await billing.handleWebhook(open(linkOf(payload)))
      expect([payload, response.status]).toEqual([payload, 400])
      expect(events).toEqual([])
    }

    // The same payloads, whole: they are links.
    for (const payload of [
      { action: 'refund', id: 'r1', at, holdingId: purchase.id },
      { action: 'manage', id: 'm1', at, userId: 'u2', holdings: [holding] },
    ]) {
      expect((await billing.handleWebhook(open(linkOf(payload)))).response.status).toBe(200)
    }
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('plays a purchase made on the device', async () => {
    const { billing } = setup()

    const { events } = await billing.verifyPurchase({
      userId: 'u1',
      proof: { providerId: 'pri_unlock', id: 'purchase-1' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'purchase.completed',
      provider: 'console',
      userId: 'u1',
      product: 'unlock',
      holdingId: 'con_pur_purchase-1',
    })
    expect(await billing.account('u1')).toMatchObject({
      customers: { console: 'con_cus_u1' },
      holdings: [{ provider: 'console', product: 'unlock', type: 'one-time', status: 'active' }],
    })

    // The device hands the same purchase over again: nothing new.
    const again = await billing.verifyPurchase({
      userId: 'u1',
      proof: { providerId: 'pri_unlock', id: 'purchase-1' },
    })
    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])

    // Without an id every proof is a purchase of its own.
    await billing.verifyPurchase({ userId: 'u1', proof: { providerId: 'pri_unlock' } })
    await billing.verifyPurchase({ userId: 'u1', proof: { providerId: 'pri_unlock' } })
    expect((await billing.account('u1')).holdings).toHaveLength(3)
  })

  it('starts a subscription from the device, which the page cancels and refunds', async () => {
    const { billing } = setup()

    await billing.verifyPurchase({ userId: 'u1', proof: { providerId: 'pri_pro', id: 's1' } })

    const [subscription] = (await billing.account('u1')).holdings
    expect(subscription).toMatchObject({
      id: 'con_sub_s1',
      product: 'pro',
      type: 'subscription',
      status: 'active',
    })
    expect(subscription!.currentPeriodEnd!.getTime() - subscription!.startedAt.getTime()).toBe(
      30 * DAY,
    )

    const [item] = await manage(billing, 'u1')
    await billing.handleWebhook(open(item!.links['Cancel at the end of the period']!))
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: subscription!.currentPeriodEnd,
    })

    await billing.handleWebhook(open(item!.links.Refund!))
    expect((await billing.account('u1')).holdings[0]).toMatchObject({ status: 'refunded' })
  })

  it('refuses a purchase another user handed over first, and a proof that is none', async () => {
    const { billing } = setup()
    await billing.verifyPurchase({ userId: 'u1', proof: { providerId: 'pri_unlock', id: 'p1' } })

    await expect(
      billing.verifyPurchase({ userId: 'u2', proof: { providerId: 'pri_unlock', id: 'p1' } }),
    ).rejects.toMatchObject({ reason: 'other-user' })

    const none: unknown[] = [
      null,
      'pri_unlock',
      {},
      { providerId: 7 },
      { providerId: '' },
      { providerId: 'pri_unlock', id: 'a b' },
      { providerId: 'pri_unlock', id: 'x'.repeat(65) },
      { providerId: 'pri_unlock', id: 1 },
    ]
    for (const proof of none) {
      const refused = billing.verifyPurchase({ userId: 'u2', proof })
      await expect(refused).rejects.toThrow(BillingPurchaseError)
      await expect(refused).rejects.toMatchObject({ reason: 'invalid' })
    }
    expect((await billing.account('u2')).holdings).toEqual([])
  })

  it('skips a purchase of something the config does not sell', async () => {
    const { billing } = setup()

    const { events, skipped } = await billing.verifyPurchase({
      userId: 'u1',
      // Also the name of something every object has: it is no product.
      proof: { providerId: 'constructor' },
    })

    expect(events).toEqual([])
    expect(skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('keeps a query string the webhook URL already has, and ids of any writing', async () => {
    const billing = createBilling({
      driver: 'console',
      console: { webhookUrl: '/hook?source=console', periodDays: 7 },
      store: createMemoryBillingStore(),
      products: { pro: { type: 'subscription', providerId: 'pri_pro' } },
    })

    const checkout = await billing.checkout({ userId: 'ü/1', product: 'pro' })
    expect(checkout.url).toMatch(/^\/hook\?source=console&console=/)

    await billing.handleWebhook(open(checkout.url))
    const [subscription] = (await billing.account('ü/1')).holdings
    expect(subscription!.currentPeriodEnd!.getTime() - subscription!.startedAt.getTime()).toBe(
      7 * DAY,
    )

    const manageUrl = await billing.manageUrl('ü/1')
    expect(manageUrl).toMatch(/^\/hook\?source=console&console=/)
    const page = await (await billing.handleWebhook(open(manageUrl))).response.text()
    expect(page).toContain('<code>ü/1</code>')
    expect(page).toContain('<a href="/hook?source=console&amp;console=')
    const [item] = managed(page)
    expect(item!.links.Refund).toMatch(/^\/hook\?source=console&console=[\w-]+$/)

    const { events } = await billing.handleWebhook(open(item!.links.Refund!))
    expect(events).toMatchObject([{ type: 'payment.refunded', userId: 'ü/1' }])
  })

  it('carries an account with many holdings in one link', async () => {
    const driver = createConsoleDriver({ webhookUrl: HOOK })
    const holdings = Array.from({ length: 1500 }, (_, index): BillingHolding => ({
      provider: 'console',
      id: `con_pur_${String(index).padStart(36, '0')}`,
      product: 'unlock',
      type: 'one-time',
      status: 'active',
      startedAt: new Date(),
      currentPeriodEnd: null,
      accessEndsAt: null,
      pastDueSince: null,
      updatedAt: new Date(),
    }))

    const url = await driver.createManageUrl({
      userId: 'u1',
      customerId: null,
      holdings,
      providerIds: {},
    })
    const { response } = await driver.parseWebhook(open(url))

    expect(managed(await response!.text())).toHaveLength(1500)
  })
})
