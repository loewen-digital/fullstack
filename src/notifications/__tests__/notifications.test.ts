import { describe, it, expect, vi } from 'vitest'
import { createNotifications } from '../index.js'
import type { Notification, NotificationUser } from '../types.js'
import type { MailMessage } from '../../mail/types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeMail() {
  const sent: MailMessage[] = []
  return {
    async send(msg: MailMessage) { sent.push(msg) },
    render: () => '',
    get sent() { return sent },
  }
}

const user: NotificationUser = { id: 'u1', email: 'alice@example.com', phone: '+1555000000' }

class WelcomeNotification implements Notification {
  channels() { return ['mail', 'in-app'] as const }
  toMail(_user: NotificationUser): MailMessage {
    return { to: _user.email!, subject: 'Welcome!', text: 'Welcome to the app.' }
  }
  toInApp(_user: NotificationUser) {
    return { type: 'welcome', title: 'Welcome!', message: 'You are in.' }
  }
}

class SmsOnlyNotification implements Notification {
  channels() { return ['sms'] as const }
  toSms(_user: NotificationUser) { return 'Your code is 123456' }
}

class PushOnlyNotification implements Notification {
  channels() { return ['push'] as const }
  toPush(_user: NotificationUser) { return { title: 'Hello', body: 'World' } }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createNotifications', () => {
  it('creates a notifications instance', () => {
    const notifs = createNotifications({})
    expect(notifs.notify).toBeInstanceOf(Function)
    expect(notifs.getInApp).toBeInstanceOf(Function)
  })
})

describe('mail channel', () => {
  it('sends via mail instance', async () => {
    const mail = fakeMail()
    const notifs = createNotifications({}, { mail })
    await notifs.notify(user, new WelcomeNotification())
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]!.subject).toBe('Welcome!')
  })

  it('throws when mail instance is missing', async () => {
    const notifs = createNotifications({})
    const n: Notification = { channels: () => ['mail'], toMail: () => ({ to: 'x@x.com', subject: 'Hi', text: '' }) }
    await expect(notifs.notify(user, n)).rejects.toThrow('Mail instance required')
  })
})

describe('in-app channel', () => {
  it('stores in-app notification', async () => {
    const mail = fakeMail()
    const notifs = createNotifications({}, { mail })
    await notifs.notify(user, new WelcomeNotification())

    const msgs = notifs.getInApp('u1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.title).toBe('Welcome!')
    expect(msgs[0]!.read).toBe(false)
    expect(msgs[0]!.userId).toBe('u1')
  })

  it('starts unread', async () => {
    const notifs = createNotifications({})
    const n: Notification = {
      channels: () => ['in-app'],
      toInApp: () => ({ type: 'test', title: 'T', message: 'M' }),
    }
    await notifs.notify(user, n)
    expect(notifs.unreadCount('u1')).toBe(1)
  })

  it('markAsRead marks individual notification', async () => {
    const notifs = createNotifications({})
    const n: Notification = {
      channels: () => ['in-app'],
      toInApp: () => ({ type: 'test', title: 'T', message: 'M' }),
    }
    await notifs.notify(user, n)
    const [msg] = notifs.getInApp('u1')
    notifs.markAsRead(msg!.id)
    expect(notifs.getInApp('u1')[0]!.read).toBe(true)
    expect(notifs.unreadCount('u1')).toBe(0)
  })

  it('markAllAsRead marks all for user', async () => {
    const notifs = createNotifications({})
    const mkNotif = (): Notification => ({
      channels: () => ['in-app'],
      toInApp: () => ({ type: 'test', title: 'T', message: 'M' }),
    })
    await notifs.notify(user, mkNotif())
    await notifs.notify(user, mkNotif())
    notifs.markAllAsRead('u1')
    expect(notifs.unreadCount('u1')).toBe(0)
  })

  it('getInApp only returns notifications for the given user', async () => {
    const notifs = createNotifications({})
    const u2: NotificationUser = { id: 'u2' }
    const n: Notification = {
      channels: () => ['in-app'],
      toInApp: () => ({ type: 'test', title: 'T', message: 'M' }),
    }
    await notifs.notify(user, n)
    await notifs.notify(u2, n)
    expect(notifs.getInApp('u1')).toHaveLength(1)
    expect(notifs.getInApp('u2')).toHaveLength(1)
  })
})

describe('SMS channel', () => {
  it('sends via sms driver', async () => {
    const send = vi.fn()
    const sms = { send }
    const notifs = createNotifications({}, { sms })
    await notifs.notify(user, new SmsOnlyNotification())
    expect(send).toHaveBeenCalledWith('+1555000000', 'Your code is 123456')
  })

  it('throws when sms driver is missing', async () => {
    const notifs = createNotifications({})
    await expect(notifs.notify(user, new SmsOnlyNotification())).rejects.toThrow('SMS driver required')
  })
})

describe('Push channel', () => {
  it('sends via push driver', async () => {
    const send = vi.fn()
    const push = { send }
    const notifs = createNotifications({}, { push })
    await notifs.notify(user, new PushOnlyNotification())
    expect(send).toHaveBeenCalledWith('u1', { title: 'Hello', body: 'World' })
  })

  it('throws when push driver is missing', async () => {
    const notifs = createNotifications({})
    await expect(notifs.notify(user, new PushOnlyNotification())).rejects.toThrow('Push driver required')
  })
})
