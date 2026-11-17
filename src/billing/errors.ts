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

/** Why billing does not take the proof of a purchase */
export type BillingPurchaseReason =
  /** The proof is not a valid one of the provider: wrong shape, signature, app or environment */
  | 'invalid'
  /** The purchase is another user's: the proof names them, or they handed it over first */
  | 'other-user'

/**
 * The proof of a purchase made on the device that billing does not take. Drivers throw it from
 * `verifyPurchase`; billing throws it for a purchase that belongs to another user. Nothing is
 * changed, and the message never carries the proof.
 */
export class BillingPurchaseError extends BillingError {
  override name = 'BillingPurchaseError'
  readonly reason: BillingPurchaseReason

  constructor(message: string, reason: BillingPurchaseReason = 'invalid') {
    super(message)
    this.reason = reason
  }
}
