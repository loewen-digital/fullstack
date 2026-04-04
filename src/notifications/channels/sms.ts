import type { Notification, NotificationUser, SmsDriver } from '../types.js'

export async function deliverSms(
  driver: SmsDriver,
  user: NotificationUser,
  notification: Notification,
): Promise<void> {
  if (!notification.toSms) {
    throw new Error('Notification does not implement toSms()')
  }
  const phone = user.phone
  if (!phone) {
    throw new Error(`User ${String(user.id)} has no phone number for SMS delivery`)
  }
  const message = notification.toSms(user)
  await driver.send(phone, message)
}
