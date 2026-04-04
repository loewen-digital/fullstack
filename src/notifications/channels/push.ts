import type { Notification, NotificationUser, PushDriver } from '../types.js'

export async function deliverPush(
  driver: PushDriver,
  user: NotificationUser,
  notification: Notification,
): Promise<void> {
  if (!notification.toPush) {
    throw new Error('Notification does not implement toPush()')
  }
  const payload = notification.toPush(user)
  await driver.send(user.id, payload)
}
