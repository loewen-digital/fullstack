import type { MailInstance } from '../../mail/types.js'
import type { Notification, NotificationUser } from '../types.js'

export async function deliverMail(
  mail: MailInstance,
  user: NotificationUser,
  notification: Notification,
): Promise<void> {
  if (!notification.toMail) {
    throw new Error('Notification does not implement toMail()')
  }
  const message = notification.toMail(user)
  await mail.send(message)
}
