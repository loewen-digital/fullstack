/** A misuse of the module: an unknown product, an empty user id, a store without its guarantee */
export class BillingError extends Error {
  override name = 'BillingError'
}

/**
 * A webhook request that is not a valid delivery of the provider. Drivers throw it from
 * `parseWebhook`; `handleWebhook` answers with `status` and changes nothing.
 */
export class BillingWebhookError extends BillingError {
  override name = 'BillingWebhookError'
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}
