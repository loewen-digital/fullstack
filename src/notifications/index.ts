import type { MailInstance } from '../mail/types.js'
import { InAppStore } from './channels/in-app.js'
import { deliverMail } from './channels/mail.js'
import { createPushChannel } from './channels/push.js'
import { deliverSms } from './channels/sms.js'
import type {
  InAppNotification,
  Notification,
  NotificationUser,
  NotificationsConfig,
  NotificationsInstance,
  NotifyChannelReport,
  NotifyReport,
  SmsDriver,
} from './types.js'

export type {
  DeviceRegister,
  DeviceStore,
  InAppNotification,
  InAppNotificationPayload,
  Notification,
  NotificationChannel,
  NotificationUser,
  NotificationsConfig,
  NotificationsInstance,
  NotifyChannelReport,
  NotifyReport,
  PushConfig,
  PushDelivery,
  PushDevice,
  PushDeviceInput,
  PushDeviceReport,
  PushDriver,
  PushPayload,
  SmsDriver,
} from './types.js'
export type {
  ApnsDeviceInput,
  ApnsDriverConfig,
  ApnsEnvironment,
  ApnsKey,
  ApnsTarget,
} from './drivers/apns.js'
export type {
  VapidKeys,
  WebPushDeviceInput,
  WebPushDriverConfig,
  WebPushSubscription,
  WebPushTarget,
  WebPushUrgency,
} from './drivers/web-push.js'
export { NotificationsError, PushDeviceError } from './errors.js'
export { APNS_MAX_PAYLOAD, createApnsDriver } from './drivers/apns.js'
export {
  createWebPushDriver,
  generateVapidKeys,
  webPushHosts,
  WEB_PUSH_MAX_PAYLOAD,
} from './drivers/web-push.js'
export { createMemoryDeviceStore } from './stores/memory.js'

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
 *
 *   // Push: a register of each user's devices and one driver per kind of device
 *   const notifications = createNotifications({
 *     channels: { push: { store: createMemoryDeviceStore(), drivers: [createWebPushDriver({ vapid })] } },
 *   })
 *   await notifications.devices.register(userId, { kind: 'web-push', subscription })
 *   const report = await notifications.notify(user, reminder) // report.channels[0].devices
 */
export function createNotifications(
  config: NotificationsConfig,
  deps: {
    mail?: MailInstance
    sms?: SmsDriver
  } = {},
): NotificationsInstance {
  const inAppStore = new InAppStore()
  const push = createPushChannel(config.channels?.push)

  return {
    async notify(user: NotificationUser, notification: Notification): Promise<NotifyReport> {
      const channels = notification.channels()
      const reports: NotifyChannelReport[] = []

      for (const channel of channels) {
        try {
          if (channel === 'mail') {
            if (!deps.mail) throw new Error('Mail instance required for mail channel')
            await deliverMail(deps.mail, user, notification)
            reports.push({ channel, ok: true })
          } else if (channel === 'in-app') {
            if (!notification.toInApp) {
              throw new Error('Notification does not implement toInApp()')
            }
            inAppStore.store(user, notification.toInApp(user))
            reports.push({ channel, ok: true })
          } else if (channel === 'sms') {
            const smsDriver = deps.sms ?? config.channels?.sms
            if (!smsDriver) throw new Error('SMS driver required for sms channel')
            await deliverSms(smsDriver, user, notification)
            reports.push({ channel, ok: true })
          } else if (channel === 'push') {
            const devices = await push.deliver(user, notification)
            reports.push({
              channel,
              ok: devices.every((device) => device.status !== 'failed'),
              devices,
            })
          }
        } catch (error) {
          reports.push({ channel, ok: false, error })
        }
      }

      // Re-throw if every channel threw
      const thrown = reports.filter((report) => 'error' in report)
      if (thrown.length === channels.length && channels.length > 0) {
        throw thrown[0]!.error
      }
      return { ok: reports.every((report) => report.ok), channels: reports }
    },

    devices: push.devices,

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
