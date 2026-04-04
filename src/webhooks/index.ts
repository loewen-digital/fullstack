import { verifyIncomingWebhook } from './incoming.js'
import { sendOutgoingWebhook } from './outgoing.js'
import type {
  DeliveryResult,
  IncomingVerifyOptions,
  OutgoingWebhook,
  OutgoingWebhookLog,
  WebhooksConfig,
  WebhooksInstance,
} from './types.js'

export type {
  DeliveryResult,
  IncomingVerifyOptions,
  IncomingVerifyResult,
  OutgoingWebhook,
  OutgoingWebhookLog,
  WebhooksConfig,
  WebhooksInstance,
  SignatureAlgorithm,
} from './types.js'
export { verifyIncomingWebhook, signPayload } from './incoming.js'
export { sendOutgoingWebhook } from './outgoing.js'

let logCounter = 0
function generateLogId(): string {
  return `whlog_${Date.now()}_${++logCounter}`
}

/**
 * Create a webhooks instance for incoming verification and outgoing delivery.
 *
 * Usage:
 *   const webhooks = createWebhooks({ secret: process.env.WEBHOOK_SECRET })
 *
 *   // Verify incoming (e.g. from GitHub)
 *   const result = await webhooks.verify(request, {
 *     secret: 'my-secret',
 *     header: 'x-hub-signature-256',
 *     prefix: 'sha256=',
 *   })
 *
 *   // Send outgoing webhook
 *   const delivery = await webhooks.send({
 *     url: 'https://example.com/hook',
 *     event: 'order.completed',
 *     payload: { orderId: '123' },
 *   })
 */
export function createWebhooks(config: WebhooksConfig = {}): WebhooksInstance {
  const logs: OutgoingWebhookLog[] = []

  return {
    async verify(
      request: Request,
      options: IncomingVerifyOptions,
    ) {
      return verifyIncomingWebhook(request, options)
    },

    async send(webhook: OutgoingWebhook): Promise<DeliveryResult> {
      const result = await sendOutgoingWebhook(webhook, config)

      logs.push({
        id: generateLogId(),
        url: webhook.url,
        event: webhook.event,
        payload: webhook.payload,
        result,
        deliveredAt: new Date(),
      })

      return result
    },

    getLogs(): OutgoingWebhookLog[] {
      return [...logs]
    },
  }
}
