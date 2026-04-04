import type { MailInstance } from '../mail/types.js'
import { InAppStore } from './channels/in-app.js'
import { deliverMail } from './channels/mail.js'
import { deliverPush } from './channels/push.js'
import { deliverSms } from './channels/sms.js'
import type {
  InAppNotification,
  Notification,
  NotificationUser,
  NotificationsConfig,
  NotificationsInstance,
  PushDriver,
  SmsDriver,
} from './types.js'

export type {
  InAppNotification,
  InAppNotificationPayload,
  Notification,
  NotificationUser,
  NotificationsConfig,
  NotificationsInstance,
  PushDriver,
  PushPayload,
  SmsDriver,
} from './types.js'

/**
 * Create a notifications instance.
 *
 * Usage:
 *   const notifications = createNotifications({}, { mail })
 *   await notifications.notify(user, new WelcomeNotification())
 *
 *   // In-app notifications
 *   const messages = notifications.getInApp(user.id)
 *   notifications.markAsRead(messages[0].id)
 */
export function createNotifications(
  config: NotificationsConfig,
  deps: {
    mail?: MailInstance
    sms?: SmsDriver
    push?: PushDriver
  } = {},
): NotificationsInstance {
  const inAppStore = new InAppStore()

  return {
    async notify(user: NotificationUser, notification: Notification): Promise<void> {
      const channels = notification.channels()
      const errors: unknown[] = []

      for (const channel of channels) {
        try {
          if (channel === 'mail') {
            if (!deps.mail) throw new Error('Mail instance required for mail channel')
            await deliverMail(deps.mail, user, notification)
          } else if (channel === 'in-app') {
            if (!notification.toInApp) {
              throw new Error('Notification does not implement toInApp()')
            }
            inAppStore.store(user, notification.toInApp(user))
          } else if (channel === 'sms') {
            const smsDriver = deps.sms ?? config.channels?.sms
            if (!smsDriver) throw new Error('SMS driver required for sms channel')
            await deliverSms(smsDriver, user, notification)
          } else if (channel === 'push') {
            const pushDriver = deps.push ?? config.channels?.push
            if (!pushDriver) throw new Error('Push driver required for push channel')
            await deliverPush(pushDriver, user, notification)
          }
        } catch (err) {
          errors.push(err)
        }
      }

      // Re-throw if all channels failed
      if (errors.length === channels.length && channels.length > 0) {
        throw errors[0]
      }
    },

    getInApp(userId: string | number): InAppNotification[] {
      return inAppStore.getForUser(userId)
    },

    unreadCount(userId: string | number): number {
      return inAppStore.unreadCount(userId)
    },

    markAsRead(notificationId: string): void {
      inAppStore.markAsRead(notificationId)
    },

    markAllAsRead(userId: string | number): void {
      inAppStore.markAllAsRead(userId)
    },
  }
}
