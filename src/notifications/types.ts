import type { MailMessage } from '../mail/types.js'

export interface NotificationsConfig {
  channels?: {
    sms?: SmsDriver
    push?: PushDriver
  }
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
  icon?: string
  data?: Record<string, unknown>
}

// ── Notification ─────────────────────────────────────────────────────────────

export interface Notification {
  /** Which channels to deliver on */
  channels(): ReadonlyArray<'mail' | 'in-app' | 'sms' | 'push'>

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

export interface PushDriver {
  send(userId: string | number, payload: PushPayload): Promise<void>
}

// ── Instance ─────────────────────────────────────────────────────────────────

export interface NotificationsInstance {
  /** Send a notification to a user via all configured channels */
  notify(user: NotificationUser, notification: Notification): Promise<void>

  /** Return all in-app notifications for a user */
  getInApp(userId: string | number): InAppNotification[]

  /** Return unread count */
  unreadCount(userId: string | number): number

  /** Mark a single notification as read */
  markAsRead(notificationId: string): void

  /** Mark all notifications for a user as read */
  markAllAsRead(userId: string | number): void
}
