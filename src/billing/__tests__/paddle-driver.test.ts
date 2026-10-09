import { afterEach, describe, it, expect, vi } from 'vite-plus/test'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BillingError, createBilling, createMemoryBillingStore } from '../index.js'

// Paddle's documented example notifications, see fixtures/paddle/README.md. What the sandbox
// really sent is replayed at the end of this file.
type Notification = {
  event_id: string
  event_type: string
  occurred_at: string
  data: Record<string, unknown> & { items: { price?: { id: string; billing_cycle: unknown } }[] }
}

function fixture(name: string): Notification {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/paddle/${name}.json`, import.meta.url), 'utf8'),
  ) as Notification
}

/** A fixture with another event id and time, and some fields of `data` replaced */
function edit(
  base: Notification,
  eventId: string,
  occurredAt: string,
  data: Record<string, unknown> = {},
): Notification {
  return {
    ...base,
    event_id: eventId,
    occurred_at: occurredAt,
    data: { ...base.data, ...data } as Notification['data'],
  }
}

// Made up per run: no real secret is anywhere near the tests.
const SECRET = `test_secret_${randomUUID()}`
const API_KEY = `test_key_${randomUUID()}`

const SEATS = 'pri_01gsz8x8sawmvhz1pv30nge1ke' // recurring, the first item of the subscription
const ADDON = 'pri_01gsz98e27ak2tyhexptwc58yk' // one-time, the third item of the transaction
const SUBSCRIPTION = 'sub_01hv8x29kz0t586xy6zn1a62ny'
const TRANSACTION = 'txn_01hv8wptq8987qeep44cyrewp9'
const CUSTOMER = 'ctm_01hv6y1jedq4p1n0yqn5ba3ky4'
const USER = { custom_data: { userId: 'u1' } }

const sign = (body: string, timestamp: number, secret = SECRET): string =>
  createHmac('sha256', secret).update(`${timestamp}:${body}`).digest('hex')

const now = (): number => Math.floor(Date.now() / 1000)

/** A delivery as Paddle sends it: the body, and a signature over timestamp and body */
function delivery(
  notification: unknown,
  options: { timestamp?: number; secret?: string; header?: string | null; body?: string } = {},
): Request {
  const body = JSON.stringify(notification)
  const timestamp = options.timestamp ?? now()
  const header =
    options.header === undefined
      ? `ts=${timestamp};h1=${sign(body, timestamp, options.secret)}`
      : options.header
  return new Request('https://app.example/billing/webhook', {
    method: 'POST',
    headers: header === null ? {} : { 'Paddle-Signature': header },
    body: options.body ?? body,
  })
}

function setup(
  paddle: { sandbox?: boolean; checkoutUrl?: string; toleranceSeconds?: number } = {},
) {
  const onError = vi.fn()
  const billing = createBilling({
    driver: 'paddle',
    paddle: { apiKey: API_KEY, webhookSecret: SECRET, ...paddle },
    store: createMemoryBillingStore(),
    products: {
      seats: { type: 'subscription', providerId: SEATS },
      addon: { type: 'one-time', providerId: ADDON },
    },
    onError,
  })
  const holding = async (id: string) =>
    (await billing.account('u1')).holdings.find((entry) => entry.id === id)
  return { billing, holding, onError }
}

/** Paddle's API as the driver sees it: records the calls and answers with `answer` */
function stubPaddle(answer: unknown, status = 200) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    })
    return Response.json(answer, { status })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('paddle driver: webhook verification', () => {
  const started = edit(fixture('subscription-created'), 'evt_1', '2024-04-12T10:18:49Z', USER)

  it('applies a delivery with a valid signature', async () => {
    const { billing, holding } = setup()

    const { response, events } = await billing.handleWebhook(delivery(started))

    expect(response.status).toBe(200)
    expect(events.map((event) => event.type)).toEqual(['subscription.started'])
    expect(await holding(SUBSCRIPTION)).toMatchObject({ product: 'seats', status: 'active' })
  })

  it.each([
    ['a signature made with another secret', delivery(started, { secret: 'another secret' })],
    [
      'a body that was changed after signing',
      delivery(started, { body: JSON.stringify(started).replace('"u1"', '"u2"') }),
    ],
    ['no signature header', delivery(started, { header: null })],
    ['a header without a timestamp', delivery(started, { header: `h1=${'a'.repeat(64)}` })],
    ['a header without a signature', delivery(started, { header: `ts=${now()}` })],
    ['a signature that is not hex', delivery(started, { header: `ts=${now()};h1=not-hex` })],
    [
      'a timestamp that is not a number',
      delivery(started, { header: `ts=soon;h1=${'a'.repeat(64)}` }),
    ],
  ])('rejects %s and changes nothing', async (_what, request) => {
    const { billing, onError } = setup()

    const { response, events } = await billing.handleWebhook(request)

    expect(response.status).toBe(401)
    expect(events).toEqual([])
    expect((await billing.account('u1')).holdings).toEqual([])
    expect((await billing.account('u2')).holdings).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('rejects a correctly signed delivery whose timestamp is outside the tolerance', async () => {
    const { billing } = setup()

    const stale = await billing.handleWebhook(delivery(started, { timestamp: now() - 6 }))
    const ahead = await billing.handleWebhook(delivery(started, { timestamp: now() + 60 }))
    expect(stale.response.status).toBe(401)
    expect(ahead.response.status).toBe(401)
    expect((await billing.account('u1')).holdings).toEqual([])

    const fresh = await billing.handleWebhook(delivery(started, { timestamp: now() - 3 }))
    expect(fresh.response.status).toBe(200)
  })

  it('takes the tolerance from the config', async () => {
    const { billing } = setup({ toleranceSeconds: 120 })

    const old = await billing.handleWebhook(delivery(started, { timestamp: now() - 90 }))
    const tooOld = await billing.handleWebhook(
      delivery(edit(started, 'evt_2', '2024-04-12T10:19:00Z'), { timestamp: now() - 150 }),
    )

    expect(old.response.status).toBe(200)
    expect(tooOld.response.status).toBe(401)
  })

  it('accepts one matching signature among several, as during a secret rotation', async () => {
    const { billing } = setup()
    const body = JSON.stringify(started)
    const timestamp = now()

    const { response } = await billing.handleWebhook(
      delivery(started, {
        header: `ts=${timestamp};h1=${sign(body, timestamp, 'the old secret')};h1=${sign(body, timestamp)}`,
      }),
    )

    expect(response.status).toBe(200)
  })

  it('answers a GET with 405 and a signed body that is no notification with 400', async () => {
    const { billing, onError } = setup()

    const get = await billing.handleWebhook(new Request('https://app.example/billing/webhook'))
    const empty = await billing.handleWebhook(delivery({}))
    const text = await billing.handleWebhook(delivery('ignored', { body: 'not json' }))
    const broken = await billing.handleWebhook(
      delivery(edit(started, 'evt_3', '2024-04-12T10:20:00Z', { id: null })),
    )

    expect(get.response.status).toBe(405)
    expect(empty.response.status).toBe(400)
    // The signature covers another body than the one sent.
    expect(text.response.status).toBe(401)
    expect(broken.response.status).toBe(400)
    expect(onError).not.toHaveBeenCalled()
  })

  it('never puts the secrets into an answer', async () => {
    const { billing } = setup()

    const rejected = await billing.handleWebhook(delivery(started, { secret: 'another secret' }))

    const answer = await rejected.response.text()
    expect(answer).not.toContain(SECRET)
    expect(answer).not.toContain(API_KEY)
  })
})

describe('paddle driver: events', () => {
  const created = edit(fixture('subscription-created'), 'evt_created', '2024-04-12T10:18:49Z', USER)

  it('starts a subscription from subscription.created', async () => {
    const { billing, holding } = setup()

    const { events } = await billing.handleWebhook(delivery(created))

    expect(events).toEqual([
      {
        id: 'evt_created',
        type: 'subscription.started',
        occurredAt: new Date('2024-04-12T10:18:49Z'),
        userId: 'u1',
        product: 'seats',
        holdingId: SUBSCRIPTION,
        currentPeriodEnd: new Date('2024-05-12T10:18:47.635628Z'),
      },
    ])
    expect(await billing.account('u1')).toMatchObject({ customerId: CUSTOMER })
    expect(await holding(SUBSCRIPTION)).toMatchObject({
      type: 'subscription',
      status: 'active',
      currentPeriodEnd: new Date('2024-05-12T10:18:47.635628Z'),
    })
  })

  it('completes a one-time purchase from transaction.completed', async () => {
    const { billing, holding } = setup()
    // Paddle's example is the first payment of a subscription with a one-time item next to it:
    // the subscription starts with `subscription.created`, the one-time item is the purchase.
    const completed = edit(
      fixture('transaction-completed'),
      'evt_txn',
      '2024-04-12T10:18:50Z',
      USER,
    )

    const { events } = await billing.handleWebhook(delivery(completed))

    expect(events).toEqual([
      expect.objectContaining({
        id: 'evt_txn',
        type: 'purchase.completed',
        userId: 'u1',
        product: 'addon',
        holdingId: TRANSACTION,
      }),
    ])
    expect(await holding(TRANSACTION)).toMatchObject({ type: 'one-time', status: 'active' })
    expect(await holding(SUBSCRIPTION)).toBeUndefined()
  })

  it('gives every one-time price of a transaction a purchase of its own', async () => {
    const { billing } = setup()
    const base = fixture('transaction-completed')
    const oneTime = (id: string) => ({ quantity: 1, price: { id, billing_cycle: null } })
    const completed = edit(base, 'evt_txn', '2024-04-12T10:18:50Z', {
      ...USER,
      subscription_id: null,
      items: [oneTime(ADDON), oneTime('pri_other')],
    })

    const { events, skipped } = await billing.handleWebhook(delivery(completed))

    expect(events.map((event) => [event.id, event.holdingId])).toEqual([['evt_txn', TRANSACTION]])
    expect(skipped).toEqual([
      {
        reason: 'unknown-product',
        event: expect.objectContaining({
          id: 'evt_txn:pri_other',
          holdingId: `${TRANSACTION}:pri_other`,
        }),
      },
    ])
  })

  it('renews a subscription from the completed transaction of a renewal', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))
    // Derived: Paddle's example with the origin and the period of a renewal, recurring items only.
    const base = fixture('transaction-completed')
    const renewal = edit(base, 'evt_renewal', '2024-05-12T10:19:00Z', {
      ...USER,
      id: 'txn_renewal',
      origin: 'subscription_recurring',
      billing_period: { starts_at: '2024-05-12T10:18:47Z', ends_at: '2024-06-12T10:18:47Z' },
      items: base.data.items.filter((item) => item.price?.billing_cycle != null),
    })

    const { events } = await billing.handleWebhook(delivery(renewal))

    expect(events).toEqual([
      expect.objectContaining({
        id: 'evt_renewal',
        type: 'subscription.renewed',
        holdingId: SUBSCRIPTION,
        currentPeriodEnd: new Date('2024-06-12T10:18:47Z'),
      }),
    ])
    expect(await holding(SUBSCRIPTION)).toMatchObject({
      status: 'active',
      currentPeriodEnd: new Date('2024-06-12T10:18:47Z'),
    })
  })

  it('reports a change from subscription.updated, once per change', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))
    const updated = fixture('subscription-updated')

    const first = await billing.handleWebhook(
      delivery(edit(updated, 'evt_u1', '2024-04-12T10:49:43Z', USER)),
    )
    // Paddle sends `subscription.updated` for changes billing does not keep (a quantity).
    const second = await billing.handleWebhook(
      delivery(edit(updated, 'evt_u2', '2024-04-12T10:50:00Z', USER)),
    )

    expect(first.events.map((event) => event.type)).toEqual(['subscription.changed'])
    expect(second.events).toEqual([])
    expect(second.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect(await holding(SUBSCRIPTION)).toMatchObject({
      status: 'active',
      currentPeriodEnd: new Date('2024-05-12T10:37:59.556997Z'),
    })
  })

  it('marks a failed payment and takes it back when the subscription is active again', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))

    const pastDue = edit(fixture('subscription-past-due'), 'evt_pd', '2024-05-12T10:19:26Z', USER)
    const failed = await billing.handleWebhook(delivery(pastDue))
    expect(failed.events.map((event) => event.type)).toEqual(['payment.failed'])
    expect(await holding(SUBSCRIPTION)).toMatchObject({ status: 'past_due' })

    // The `subscription.updated` that may follow the dedicated event says the same.
    const echo = await billing.handleWebhook(
      delivery({
        ...edit(pastDue, 'evt_pd2', '2024-05-12T10:19:27Z'),
        event_type: 'subscription.updated',
      }),
    )
    expect(echo.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])

    // Paddle collected the payment on a retry: the subscription is active again.
    const recovered = edit(fixture('subscription-updated'), 'evt_ok', '2024-05-14T08:00:00Z', USER)
    await billing.handleWebhook(delivery(recovered))
    expect(await holding(SUBSCRIPTION)).toMatchObject({ status: 'active' })
  })

  it('ends a subscription at the date of a scheduled cancel, and takes that back', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))
    // Derived: Paddle's example with a cancel scheduled for the end of the period.
    const updated = fixture('subscription-updated')
    const scheduled = edit(updated, 'evt_s', '2024-04-20T09:00:00Z', {
      ...USER,
      scheduled_change: { action: 'cancel', effective_at: '2024-05-12T10:37:59Z', resume_at: null },
    })

    const { events } = await billing.handleWebhook(delivery(scheduled))

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subscription.canceled',
        accessEndsAt: new Date('2024-05-12T10:37:59Z'),
      }),
    ])
    expect(await holding(SUBSCRIPTION)).toMatchObject({
      status: 'canceled',
      accessEndsAt: new Date('2024-05-12T10:37:59Z'),
    })

    // The customer changed their mind in the portal: the scheduled change is gone.
    await billing.handleWebhook(delivery(edit(updated, 'evt_back', '2024-04-21T09:00:00Z', USER)))
    expect(await holding(SUBSCRIPTION)).toMatchObject({ status: 'active', accessEndsAt: null })
  })

  it('keeps a canceled subscription canceled when subscription.updated follows', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))
    const canceled = edit(fixture('subscription-canceled'), 'evt_c', '2024-04-12T11:24:55Z', USER)

    const { events } = await billing.handleWebhook(delivery(canceled))
    const echo = await billing.handleWebhook(
      delivery({
        ...edit(canceled, 'evt_c2', '2024-04-12T11:24:56Z'),
        event_type: 'subscription.updated',
      }),
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subscription.canceled',
        accessEndsAt: new Date('2024-04-12T11:24:54.868Z'),
      }),
    ])
    expect(echo.events).toEqual([])
    expect(echo.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect(await holding(SUBSCRIPTION)).toMatchObject({
      status: 'canceled',
      accessEndsAt: new Date('2024-04-12T11:24:54.868Z'),
    })
  })

  it('ends access when a subscription is paused', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))
    // Derived: Paddle's example in the state a pause leaves it in.
    const paused = edit(fixture('subscription-updated'), 'evt_p', '2024-04-25T09:00:00Z', {
      ...USER,
      status: 'paused',
      paused_at: '2024-04-25T08:59:59Z',
      current_billing_period: null,
    })

    await billing.handleWebhook(delivery({ ...paused, event_type: 'subscription.paused' }))

    expect(await holding(SUBSCRIPTION)).toMatchObject({
      status: 'canceled',
      accessEndsAt: new Date('2024-04-25T08:59:59Z'),
    })
  })

  it('ignores a refund that is partial or not approved yet', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(delivery(created))

    // Paddle's examples are a partial refund waiting for approval.
    const pending = await billing.handleWebhook(delivery(fixture('adjustment-created')))
    const partial = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-updated'), 'evt_a2', '2024-04-15T09:00:00Z', {
          status: 'approved',
        }),
      ),
    )
    const rejected = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-updated'), 'evt_a3', '2024-04-15T09:01:00Z', {
          status: 'rejected',
          type: 'full',
        }),
      ),
    )

    // The whole item, but not approved yet: this is what the dashboard's refund starts as.
    const wholeItemPending = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-created'), 'evt_a4', '2024-04-15T09:02:00Z', {
          items: [{ item_id: 'txnitm_1', type: 'full' }],
        }),
      ),
    )
    // Tax only, or a share of the period: not the purchase.
    const taxOnly = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-updated'), 'evt_a5', '2024-04-15T09:03:00Z', {
          status: 'approved',
          items: [{ item_id: 'txnitm_1', type: 'tax' }],
        }),
      ),
    )
    const oneOfTwo = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-updated'), 'evt_a6', '2024-04-15T09:04:00Z', {
          status: 'approved',
          items: [
            { item_id: 'txnitm_1', type: 'full' },
            { item_id: 'txnitm_2', type: 'partial' },
          ],
        }),
      ),
    )

    for (const result of [pending, partial, rejected, wholeItemPending, taxOnly, oneOfTwo]) {
      expect(result.response.status).toBe(200)
      expect(result.events).toEqual([])
      expect(result.skipped).toEqual([])
    }
    expect(await holding(SUBSCRIPTION)).toMatchObject({ status: 'active' })
  })

  it('refunds a subscription from an approved full refund, which names no price and no user', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(
      delivery({
        ...created,
        data: { ...created.data, id: 'sub_01hvccbx32q2gb40sqx7n42430' },
      }),
    )
    // Derived: Paddle's example, approved and for the full amount.
    const approved = { status: 'approved', type: 'full' }
    const refund = edit(
      fixture('adjustment-updated'),
      'evt_refund',
      '2024-04-15T08:54:10Z',
      approved,
    )

    const { events } = await billing.handleWebhook(delivery(refund))
    // The same refund, told again by the other adjustment event.
    const echo = await billing.handleWebhook(
      delivery(
        edit(fixture('adjustment-created'), 'evt_refund2', '2024-04-15T08:54:11Z', approved),
      ),
    )

    expect(events).toEqual([
      {
        id: 'evt_refund',
        type: 'payment.refunded',
        occurredAt: new Date('2024-04-15T08:54:10Z'),
        userId: 'u1',
        product: 'seats',
        holdingId: 'sub_01hvccbx32q2gb40sqx7n42430',
      },
    ])
    expect(echo.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect(await holding('sub_01hvccbx32q2gb40sqx7n42430')).toMatchObject({
      status: 'refunded',
      accessEndsAt: new Date('2024-04-15T08:54:10Z'),
    })
  })

  it('refunds from the adjustment the dashboard sends: partial by type, every item in full', async () => {
    const { billing, holding } = setup()
    await billing.handleWebhook(
      delivery({ ...created, data: { ...created.data, id: 'sub_01hvccbx32q2gb40sqx7n42430' } }),
    )
    // As recorded in the sandbox for a refund of the whole payment: `type` stays `partial`.
    const refund = edit(fixture('adjustment-updated'), 'evt_refund', '2024-04-15T08:54:10Z', {
      status: 'approved',
      type: 'partial',
      items: [{ item_id: 'txnitm_01hvcc94b7qgz60qmrqmbm19zw', type: 'full' }],
    })

    const { events } = await billing.handleWebhook(delivery(refund))

    expect(events.map((event) => event.type)).toEqual(['payment.refunded'])
    expect(await holding('sub_01hvccbx32q2gb40sqx7n42430')).toMatchObject({ status: 'refunded' })
  })

  it('refunds a one-time purchase, also when the refund is delivered first', async () => {
    const { billing, holding } = setup()
    const purchase = edit(fixture('transaction-completed'), 'evt_txn', '2024-04-12T10:18:50Z', {
      ...USER,
      subscription_id: null,
      items: [{ quantity: 1, price: { id: ADDON, billing_cycle: null } }],
    })
    // Derived: a chargeback for the whole transaction, which is no part of a subscription.
    const chargeback = edit(fixture('adjustment-created'), 'evt_cb', '2024-04-20T08:00:00Z', {
      action: 'chargeback',
      status: 'approved',
      type: 'full',
      subscription_id: null,
      transaction_id: TRANSACTION,
    })

    const early = await billing.handleWebhook(delivery(chargeback))
    expect(early.response.status).toBe(409)
    expect(early.skipped.map((entry) => entry.reason)).toEqual(['unmatched'])

    await billing.handleWebhook(delivery(purchase))
    const again = await billing.handleWebhook(delivery(chargeback))

    expect(again.response.status).toBe(200)
    expect(again.events.map((event) => event.type)).toEqual(['payment.refunded'])
    expect(await holding(TRANSACTION)).toMatchObject({ product: 'addon', status: 'refunded' })
  })

  it('answers 200 for an event type it has no use for, and for a price that is not a product', async () => {
    const { billing } = setup()

    const other = await billing.handleWebhook(
      delivery({ ...created, event_id: 'evt_x', event_type: 'customer.updated' }),
    )
    const foreign = await billing.handleWebhook(
      delivery(
        edit(created, 'evt_y', '2024-04-12T10:18:49Z', {
          items: [{ price: { id: 'pri_sold_elsewhere', billing_cycle: { interval: 'month' } } }],
        }),
      ),
    )

    expect(other.response.status).toBe(200)
    expect(other.events).toEqual([])
    expect(foreign.response.status).toBe(200)
    expect(foreign.skipped.map((entry) => entry.reason)).toEqual(['unknown-product'])
    expect((await billing.account('u1')).holdings).toEqual([])
  })

  it('applies a delivery once when Paddle sends it again', async () => {
    const { billing } = setup()

    await billing.handleWebhook(delivery(created))
    const again = await billing.handleWebhook(delivery(created))

    expect(again.response.status).toBe(200)
    expect(again.skipped.map((entry) => entry.reason)).toEqual(['duplicate'])
    expect((await billing.account('u1')).holdings).toHaveLength(1)
  })
})

describe('paddle driver: checkout and manage link', () => {
  const transaction = {
    data: {
      id: 'txn_new',
      checkout: { url: 'https://app.example/pay?_ptxn=txn_new' },
    },
  }

  it('creates a transaction that carries the user id, for a subscription and a one-time product', async () => {
    const calls = stubPaddle(transaction)
    const { billing } = setup()

    const checkout = await billing.checkout({
      userId: 'u1',
      product: 'seats',
      successUrl: '/account',
    })
    await billing.checkout({ userId: 'u1', product: 'addon' })

    expect(checkout).toEqual({ id: 'txn_new', url: 'https://app.example/pay?_ptxn=txn_new' })
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.paddle.com/transactions',
      'https://api.paddle.com/transactions',
    ])
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${API_KEY}`)
    expect(calls[0]!.body).toEqual({
      items: [{ price_id: SEATS, quantity: 1 }],
      custom_data: { userId: 'u1' },
    })
    expect(calls[1]!.body).toEqual({
      items: [{ price_id: ADDON, quantity: 1 }],
      custom_data: { userId: 'u1' },
    })
  })

  it('matches the events of a checkout to its user through the custom data it sent', async () => {
    const calls = stubPaddle(transaction)
    const { billing } = setup()
    await billing.checkout({ userId: 'user/ä 7', product: 'seats' })

    // Paddle copies the transaction's custom data onto the subscription it creates.
    const created = edit(fixture('subscription-created'), 'evt_1', '2024-04-12T10:18:49Z', {
      custom_data: calls[0]!.body.custom_data,
    })
    await billing.handleWebhook(delivery(created))

    expect((await billing.account('user/ä 7')).holdings).toEqual([
      expect.objectContaining({ id: SUBSCRIPTION, product: 'seats', status: 'active' }),
    ])
  })

  it('talks to the sandbox, sends the checkout page of the config and the known customer', async () => {
    const calls = stubPaddle(transaction)
    const { billing } = setup({ sandbox: true, checkoutUrl: 'https://app.example/pay' })
    await billing.handleWebhook(
      delivery(edit(fixture('subscription-created'), 'evt_1', '2024-04-12T10:18:49Z', USER)),
    )

    await billing.checkout({ userId: 'u1', product: 'addon' })

    expect(calls[0]!.url).toBe('https://sandbox-api.paddle.com/transactions')
    expect(calls[0]!.body).toMatchObject({
      customer_id: CUSTOMER,
      checkout: { url: 'https://app.example/pay' },
    })
  })

  it('returns no URL when Paddle has no payment link for the transaction', async () => {
    stubPaddle({ data: { id: 'txn_new', checkout: null } })
    const { billing } = setup()

    expect(await billing.checkout({ userId: 'u1', product: 'addon' })).toEqual({
      id: 'txn_new',
      url: null,
    })
  })

  it('fails with what Paddle says, and without the API key', async () => {
    stubPaddle(
      {
        error: {
          type: 'request_error',
          code: 'transaction_default_checkout_url_not_set',
          detail: 'A Default Payment Link has not yet been defined within the Paddle Dashboard',
        },
      },
      400,
    )
    const { billing } = setup()

    const failure = await billing
      .checkout({ userId: 'u1', product: 'addon' })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(BillingError)
    expect(failure.message).toContain('400')
    expect(failure.message).toContain('transaction_default_checkout_url_not_set')
    expect(failure.message).not.toContain(API_KEY)
  })

  it("opens Paddle's customer portal for the customer of the user", async () => {
    const calls = stubPaddle({
      data: { urls: { general: { overview: 'https://customer-portal.paddle.com/cpl_1?token=t' } } },
    })
    const { billing } = setup()

    // No event yet, no customer: nothing to manage, and no call to Paddle.
    expect(await billing.manageUrl('u1')).toBeNull()
    expect(calls).toHaveLength(0)

    await billing.handleWebhook(
      delivery(edit(fixture('subscription-created'), 'evt_1', '2024-04-12T10:18:49Z', USER)),
    )
    const url = await billing.manageUrl('u1', { returnUrl: '/account' })

    expect(url).toBe('https://customer-portal.paddle.com/cpl_1?token=t')
    expect(calls[0]!.url).toBe(`https://api.paddle.com/customers/${CUSTOMER}/portal-sessions`)
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${API_KEY}`)
  })

  it('needs its options, with both secrets set', () => {
    const base = { store: createMemoryBillingStore(), products: {} }

    expect(() => createBilling({ ...base, driver: 'paddle' })).toThrow(/needs the `paddle` options/)
    expect(() =>
      createBilling({ ...base, driver: 'paddle', paddle: { apiKey: '', webhookSecret: SECRET } }),
    ).toThrow(/apiKey.*webhookSecret/)
    expect(() =>
      createBilling({ ...base, driver: 'paddle', paddle: { apiKey: API_KEY, webhookSecret: '' } }),
    ).toThrow(/apiKey.*webhookSecret/)
  })
})

// What Paddle's sandbox really sent, see fixtures/paddle-sandbox/README.md.
describe('paddle driver: a recorded sandbox run', () => {
  const recording = [
    '1-one-time-transaction-completed',
    '2-subscription-created',
    '3-subscription-first-transaction-completed',
    '4-subscription-updated-cancel-scheduled',
    '5-subscription-updated-cancel-removed',
    '6-subscription-canceled',
    '7-subscription-updated-after-cancel',
  ].map(
    (name) =>
      JSON.parse(
        readFileSync(new URL(`./fixtures/paddle-sandbox/${name}.json`, import.meta.url), 'utf8'),
      ) as Notification,
  )
  const [purchase, created, firstPayment, cancelScheduled, cancelRemoved, canceled, afterCancel] =
    recording as [
      Notification,
      Notification,
      Notification,
      Notification,
      Notification,
      Notification,
      Notification,
    ]
  const transactionId = String(purchase.data.id)
  const subscriptionId = String(created.data.id)
  const periodEnd = new Date('2026-11-09T13:14:54.995903Z')
  const canceledAt = new Date('2026-10-09T13:33:03.009Z')

  function replay() {
    const billing = createBilling({
      driver: 'paddle',
      paddle: { apiKey: API_KEY, webhookSecret: SECRET },
      store: createMemoryBillingStore(),
      products: {
        unlock: {
          type: 'one-time',
          providerId: purchase.data.items[0]!.price!.id,
          features: ['themes'],
        },
        pro: {
          type: 'subscription',
          providerId: created.data.items[0]!.price!.id,
          features: ['themes', 'export'],
        },
      },
    })
    const holding = async (id: string) =>
      (await billing.account('tester')).holdings.find((entry) => entry.id === id)
    const deliver = (notification: Notification) => billing.handleWebhook(delivery(notification))
    return { billing, holding, deliver }
  }

  it('follows the purchase, the subscription, its cancel, the cancel taken back and the cancel at once', async () => {
    const { billing, holding, deliver } = replay()
    const during = { now: new Date('2026-10-09T13:30:00Z') }

    // The user id travels in the custom data the checkout set.
    const bought = await deliver(purchase)
    expect(bought.events.map((event) => [event.type, event.userId, event.product])).toEqual([
      ['purchase.completed', 'tester', 'unlock'],
    ])
    expect(await holding(transactionId)).toMatchObject({ type: 'one-time', status: 'active' })

    // Paddle copied the custom data onto the subscription.
    const started = await deliver(created)
    expect(started.events.map((event) => event.type)).toEqual(['subscription.started'])
    expect(await holding(subscriptionId)).toMatchObject({
      status: 'active',
      currentPeriodEnd: periodEnd,
    })

    // The first payment of the subscription is its start, not a purchase and not a renewal.
    const paid = await deliver(firstPayment)
    expect(paid.response.status).toBe(200)
    expect(paid.events).toEqual([])
    expect(paid.skipped).toEqual([])
    expect((await billing.account('tester')).holdings).toHaveLength(2)

    // Canceled in the customer portal for the end of the period: paid for until then.
    const scheduled = await deliver(cancelScheduled)
    expect(scheduled.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect(await holding(subscriptionId)).toMatchObject({
      status: 'canceled',
      accessEndsAt: periodEnd,
    })
    expect((await billing.entitlements('tester', during)).has('export')).toBe(true)

    // "Don't cancel subscription".
    const back = await deliver(cancelRemoved)
    expect(back.events.map((event) => event.type)).toEqual(['subscription.changed'])
    expect(await holding(subscriptionId)).toMatchObject({ status: 'active', accessEndsAt: null })

    // Canceled at once: Paddle tells it twice, with the same timestamp.
    const ended = await deliver(canceled)
    const echo = await deliver(afterCancel)
    expect(ended.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect(echo.events).toEqual([])
    expect(echo.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect(await holding(subscriptionId)).toMatchObject({
      status: 'canceled',
      accessEndsAt: canceledAt,
    })

    const after = await billing.entitlements('tester', { now: new Date('2026-10-09T13:34:00Z') })
    expect(after.products).toEqual(['unlock'])
    expect(after.has('export')).toBe(false)
    expect(await billing.account('tester')).toMatchObject({
      customerId: 'ctm_01sandboxcustomer000000000',
    })
  })

  it('ends in the same state when the two reports of the cancel arrive the other way round', async () => {
    const { holding, deliver } = replay()
    for (const notification of [purchase, created, firstPayment, cancelScheduled, cancelRemoved]) {
      await deliver(notification)
    }

    const first = await deliver(afterCancel)
    const second = await deliver(canceled)

    // `subscription.updated` in the canceled state is the cancel; the dedicated event adds nothing.
    expect(first.events.map((event) => event.type)).toEqual(['subscription.canceled'])
    expect(second.skipped.map((entry) => entry.reason)).toEqual(['unchanged'])
    expect(await holding(subscriptionId)).toMatchObject({
      status: 'canceled',
      accessEndsAt: canceledAt,
    })
  })

  it('ends in the same state when the whole run is delivered backwards, or all at once', async () => {
    const backwards = replay()
    for (const notification of [...recording].reverse()) {
      expect((await backwards.deliver(notification)).response.status).toBe(200)
    }
    const atOnce = replay()
    await Promise.all(recording.map((notification) => atOnce.deliver(notification)))

    for (const { holding } of [backwards, atOnce]) {
      expect(await holding(transactionId)).toMatchObject({ product: 'unlock', status: 'active' })
      expect(await holding(subscriptionId)).toMatchObject({
        product: 'pro',
        status: 'canceled',
        accessEndsAt: canceledAt,
      })
    }
  })
})
