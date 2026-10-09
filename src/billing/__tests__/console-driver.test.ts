import { afterEach, beforeEach, describe, it, expect, vi } from 'vite-plus/test'
import { createBilling, createMemoryBillingStore } from '../index.js'

const ORIGIN = 'https://app.example'
const DAY = 86_400_000

function setup() {
  return createBilling({
    driver: 'console',
    console: { webhookUrl: '/api/billing/webhook' },
    store: createMemoryBillingStore(),
    products: {
      unlock: { type: 'one-time', providerId: 'pri_unlock' },
      pro: { type: 'subscription', providerId: 'pri_pro' },
    },
  })
}

const open = (url: string | null, method = 'GET'): Request =>
  new Request(new URL(url ?? '', ORIGIN), { method })

describe('console billing driver', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes a one-time checkout when its URL is opened', async () => {
    const billing = setup()

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
      customerId: 'con_cus_u1',
      holdings: [{ product: 'unlock', type: 'one-time', status: 'active' }],
    })
  })

  it('applies a checkout once when its URL is opened again', async () => {
    const billing = setup()
    const checkout = await billing.checkout({ userId: 'u1', product: 'unlock' })

    await billing.handleWebhook(open(checkout.url))
    const again = await billing.handleWebhook(open(checkout.url))

    expect(again.response.status).toBe(200)
    expect(again.events).toEqual([])
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })

  it('starts a subscription with a period and cancels it through the manage link', async () => {
    const billing = setup()
    const checkout = await billing.checkout({ userId: 'u1', product: 'pro' })
    await billing.handleWebhook(open(checkout.url))

    const [subscription] = (await billing.account('u1')).holdings
    expect(subscription).toMatchObject({ product: 'pro', type: 'subscription', status: 'active' })
    expect(subscription!.currentPeriodEnd!.getTime() - subscription!.startedAt.getTime()).toBe(
      30 * DAY,
    )

    const manage = await billing.manageUrl('u1', { returnUrl: '/account' })
    const { response, events } = await billing.handleWebhook(open(manage))

    expect(response.headers.get('Location')).toBe(`${ORIGIN}/account`)
    expect(events[0]).toMatchObject({
      type: 'subscription.canceled',
      accessEndsAt: subscription!.currentPeriodEnd,
    })
    expect((await billing.account('u1')).holdings[0]).toMatchObject({
      status: 'canceled',
      accessEndsAt: subscription!.currentPeriodEnd,
    })
  })

  it('answers without a redirect when there is nowhere to go, or the target is another site', async () => {
    const billing = setup()

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
  })

  it('rejects a POST, a missing parameter and a parameter that is not a checkout', async () => {
    const billing = setup()
    const checkout = await billing.checkout({ userId: 'u1', product: 'unlock' })

    expect((await billing.handleWebhook(open(checkout.url, 'POST'))).response.status).toBe(405)
    expect((await billing.handleWebhook(open('/api/billing/webhook'))).response.status).toBe(400)
    expect(
      (await billing.handleWebhook(open('/api/billing/webhook?console=bm90LWpzb24'))).response
        .status,
    ).toBe(400)
    expect(
      (await billing.handleWebhook(open(`/api/billing/webhook?console=${btoa('{"id":1}')}`)))
        .response.status,
    ).toBe(400)
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('keeps a query string the webhook URL already has', async () => {
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
  })
})
