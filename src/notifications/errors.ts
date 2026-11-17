/** A misuse of the module: push without its config, two drivers of one kind, an empty user id */
export class NotificationsError extends Error {
  override name = 'NotificationsError'
}

/**
 * What an app handed over to register a device is not a device: no driver for its kind, a
 * subscription without keys, an endpoint that is not a push service. Answer the client with 400.
 * The message never carries the endpoint or a key.
 */
export class PushDeviceError extends NotificationsError {
  override name = 'PushDeviceError'
}
