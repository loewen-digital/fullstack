import type { MailMessage } from '../mail/types.js'

export interface NotificationsConfig {
  channels?: {
    sms?: SmsDriver
    /** The push channel: the register of each user's devices and the drivers that reach them */
    push?: PushConfig
  }
}

export interface PushConfig {
  /** Where the devices are kept: `createMemoryDeviceStore()`, `createFlatdbDeviceStore()`, your own */
  store: DeviceStore
  /** One driver per kind of device: `createWebPushDriver()` */
  drivers: readonly PushDriver[]
  /**
   * Called with what the store threw while a device the push service reported as gone was
   * removed (default: `console.error`). The device stays and is tried again with the next
   * notification.
   */
  onError?: (error: unknown) => void
}

// ── User ─────────────────────────────────────────────────────────────────────

export interface NotificationUser {
  id: string | number
  email?: string
  phone?: string
  [key: string]: unknown
}

// ── Channel payloads ─────────────────────────────────────────────────────────

export interface InAppNotificationPayload {
  type: string
  title: string
  message: string
  data?: Record<string, unknown>
}

export interface InAppNotification extends InAppNotificationPayload {
  id: string
  userId: string | number
  read: boolean
  createdAt: Date
}

export interface PushPayload {
  title: string
  body: string
  /** What a tap on the notification opens: a path of the app or a full URL */
  url?: string
  /**
   * The kind of message. A notification replaces an older one with the same tag, on the device
   * and at the push service while the device is offline.
   */
  tag?: string
  icon?: string
  data?: Record<string, unknown>
  /**
   * Seconds the push service keeps the notification for a device that is offline; after that it
   * is dropped. Left out: the driver's default.
   */
  ttl?: number
}

// ── Notification ─────────────────────────────────────────────────────────────

export type NotificationChannel = 'mail' | 'in-app' | 'sms' | 'push'

export interface Notification {
  /** Which channels to deliver on */
  channels(): ReadonlyArray<NotificationChannel>

  toMail?(user: NotificationUser): MailMessage
  toInApp?(user: NotificationUser): InAppNotificationPayload
  /** Returns the SMS message body */
  toSms?(user: NotificationUser): string
  toPush?(user: NotificationUser): PushPayload
}

// ── Channel drivers ───────────────────────────────────────────────────────────

export interface SmsDriver {
  send(to: string, message: string): Promise<void>
}

/**
 * What an app hands over to register a device: the kind, which names the driver, and whatever
 * that driver needs. Web Push: `{ kind: 'web-push', subscription }` with the browser's
 * `PushSubscription.toJSON()`.
 */
export interface PushDeviceInput {
  kind: string
  [field: string]: unknown
}

/** A device as the register keeps it */
export interface PushDevice<T = unknown> {
  /**
   * Derived from the kind and from what identifies the device there (Web Push: the endpoint),
   * so the same device registered again has the same id. It reveals neither.
   */
  id: string
  /** The kind of device, which is the `kind` of the driver that reaches it */
  kind: string
  /**
   * What the driver sends to (Web Push: the endpoint and the two keys). Personal data: it goes
   * with the account and never into a log.
   */
  target: T
  /** When the device was registered last */
  registeredAt: Date
}

/** What became of one notification for one device */
export type PushDelivery =
  /** The push service took it */
  | { status: 'sent' }
  /** The push service no longer knows the device. The register removes it */
  | { status: 'gone'; reason?: string }
  /** Not delivered, the device stays: the service was unreachable, refused, or the payload is too large */
  | { status: 'failed'; reason: string }

/** Reaches the devices of one kind */
export interface PushDriver<T = unknown> {
  /** The kind of device this driver reaches; a device carries it */
  readonly kind: string
  /**
   * What identifies a device among those of this kind, read from what the app handed over
   * without checking the rest, so a device is removed with less than it took to register it.
   * Throws `PushDeviceError` when it is missing.
   */
  keyOf(input: PushDeviceInput): string
  /**
   * Checks what the app handed over and returns what the register stores, as plain JSON data.
   * Throws `PushDeviceError` for anything that is not a device of this kind.
   */
  targetOf(input: PushDeviceInput): T | Promise<T>
  /**
   * Sends one notification to one device. A delivery that did not work is an answer, not an
   * error: `gone` when the device is to be forgotten, `failed` when it is to be kept.
   */
  send(target: T, payload: PushPayload): Promise<PushDelivery>
}

/**
 * Where the register keeps the devices. A device id belongs to one user at a time: `put` for
 * another user moves it, so a browser that changed hands stops receiving the first user's
 * notifications.
 */
export interface DeviceStore {
  /** The devices of a user, in the order they were registered; empty for an unknown user */
  list(userId: string): Promise<PushDevice[]>
  /**
   * Stores the device for the user. An entry of the same id is replaced; an entry of that id
   * held by another user is removed there.
   */
  put(userId: string, device: PushDevice): Promise<void>
  /** Removes one device of the user; `false` when the user had no such device */
  remove(userId: string, deviceId: string): Promise<boolean>
  /** Removes every device of the user and answers how many there were */
  removeAll(userId: string): Promise<number>
}

/** The devices a user switched notifications on for */
export interface DeviceRegister {
  /**
   * Registers a device for a user and returns it. The same device registered again stays one
   * entry; a device another user registered before moves to this user. Throws `PushDeviceError`
   * when the input is not a device a driver takes.
   */
  register(userId: string, device: PushDeviceInput): Promise<PushDevice>
  /**
   * Removes a device of a user, named by its id or by what identified it at registration
   * (Web Push: `{ kind: 'web-push', subscription: { endpoint } }`). `false` when there was none.
   */
  unregister(userId: string, device: string | PushDeviceInput): Promise<boolean>
  /** The devices of a user */
  list(userId: string): Promise<PushDevice[]>
  /** Removes every device of a user, for the day the account is deleted. Answers how many */
  forget(userId: string): Promise<number>
}

// ── Report ───────────────────────────────────────────────────────────────────

/** What became of a notification for one device of the user */
export interface PushDeviceReport {
  deviceId: string
  kind: string
  status: PushDelivery['status']
  /** Why it failed or is gone, in the driver's words. Never the endpoint or a key */
  reason?: string
}

export interface NotifyChannelReport {
  channel: NotificationChannel
  /** `false` when the channel could not deliver, or, for push, when a device failed */
  ok: boolean
  /** What the channel threw: no driver, no `toX` method, a send error */
  error?: unknown
  /** Push: one entry per registered device of the user; empty when the user has none */
  devices?: PushDeviceReport[]
}

/** What `notify()` did, per channel the notification named */
export interface NotifyReport {
  /** `true` when every channel delivered and no device failed */
  ok: boolean
  channels: NotifyChannelReport[]
}

// ── Instance ─────────────────────────────────────────────────────────────────

export interface NotificationsInstance {
  /**
   * Sends a notification to a user on the channels it names and answers what happened on each.
   * A failing channel or device does not stop the others; `notify` throws only when every
   * channel threw.
   */
  notify(user: NotificationUser, notification: Notification): Promise<NotifyReport>

  /**
   * The register of devices for the push channel. A user is a plain string id here; the push
   * channel looks devices up under `String(user.id)`. Every method throws `NotificationsError`
   * without `channels.push` in the config.
   */
  devices: DeviceRegister

  /** Return all in-app notifications for a user */
  getInApp(userId: string | number): InAppNotification[]

  /** Return unread count */
  unreadCount(userId: string | number): number

  /** Mark a single notification as read */
  markAsRead(notificationId: string): void

  /** Mark all notifications for a user as read */
  markAllAsRead(userId: string | number): void
}
