import type { InAppNotification, InAppNotificationPayload, NotificationUser } from '../types.js'

let counter = 0

function generateId(): string {
  return `notif_${Date.now()}_${++counter}`
}

export class InAppStore {
  private notifications = new Map<string, InAppNotification>()

  store(user: NotificationUser, payload: InAppNotificationPayload): InAppNotification {
    const notification: InAppNotification = {
      ...payload,
      id: generateId(),
      userId: user.id,
      read: false,
      createdAt: new Date(),
    }
    this.notifications.set(notification.id, notification)
    return notification
  }

  getForUser(userId: string | number): InAppNotification[] {
    return [...this.notifications.values()].filter((n) => n.userId === userId)
  }

  markAsRead(notificationId: string): void {
    const n = this.notifications.get(notificationId)
    if (n) n.read = true
  }

  markAllAsRead(userId: string | number): void {
    for (const n of this.notifications.values()) {
      if (n.userId === userId) n.read = true
    }
  }

  unreadCount(userId: string | number): number {
    return this.getForUser(userId).filter((n) => !n.read).length
  }
}
