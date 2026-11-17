import { afterAll, describe, it, expect, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsAdapter, MemoryAdapter } from '@loewen-digital/flatdb'
import {
  NotificationsError,
  PushDeviceError,
  createMemoryDeviceStore,
  createNotifications,
} from '../index.js'
import type { DeviceStore, Notification, PushDriver } from '../index.js'
import { createFlatdbDeviceStore } from '../stores/flatdb.js'
import { deviceId } from '../channels/push.js'
import { createFakePushDriver } from '../../testing/index.js'

const reminder: Notification = {
  channels: () => ['push'],
  toPush: () => ({
    title: 'Kick-off in an hour',
    body: 'Matchday 7',
    url: '/matchday/7',
    tag: 'kick-off',
  }),
}

const tmpDirs: string[] = []
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const stores: [string, () => Promise<{ store: DeviceStore; adapter?: MemoryAdapter }>][] = [
  ['memory store', async () => ({ store: createMemoryDeviceStore() })],
  [
    'flatdb store on MemoryAdapter',
    async () => {
      const adapter = new MemoryAdapter()
      return { store: createFlatdbDeviceStore({ adapter }), adapter }
    },
  ],
  [
    'flatdb store on FsAdapter',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fullstack-push-'))
      tmpDirs.push(dir)
      return { store: createFlatdbDeviceStore({ adapter: new FsAdapter(dir) }) }
    },
  ],
]

describe.each(stores)('push on the %s', (_name, createStore) => {
  async function setup() {
    const { store, adapter } = await createStore()
    const fakePush = createFakePushDriver()
    const notifications = createNotifications({
      channels: { push: { store, drivers: [fakePush] } },
    })
    return { notifications, fakePush, store, adapter }
  }

  it('registers a device for a user and removes it again', async () => {
    const { notifications, fakePush } = await setup()

    const device = await notifications.devices.register('u1', fakePush.device('laptop'))
    expect(device).toMatchObject({ kind: 'web-push', target: { key: 'laptop' } })
    expect(device.id).toMatch(/^[0-9a-f]{64}$/)
    expect(device.registeredAt).toBeInstanceOf(Date)
    expect(await notifications.devices.list('u1')).toEqual([device])

    expect(await notifications.devices.unregister('u1', device.id)).toBe(true)
    expect(await notifications.devices.list('u1')).toEqual([])
    expect(await notifications.devices.unregister('u1', device.id)).toBe(false)
  })

  it('keeps one entry when the same device registers twice', async () => {
    const { notifications, fakePush } = await setup()

    const first = await notifications.devices.register('u1', fakePush.device('laptop'))
    const second = await notifications.devices.register('u1', fakePush.device('laptop'))

    expect(second.id).toBe(first.id)
    expect(await notifications.devices.list('u1')).toHaveLength(1)
  })

  it('keeps any number of devices per user, each user their own', async () => {
    const { notifications, fakePush } = await setup()

    for (const name of ['laptop', 'phone', 'tablet']) {
      await notifications.devices.register('u1', fakePush.device(name))
    }
    await notifications.devices.register('u2', fakePush.device('desk'))

    const keys = (await notifications.devices.list('u1')).map(
      (device) => (device.target as { key: string }).key,
    )
    expect(keys).toEqual(['laptop', 'phone', 'tablet'])
    expect(await notifications.devices.list('u2')).toHaveLength(1)
    expect(await notifications.devices.list('nobody')).toEqual([])
  })

  it('keeps both devices when two register for one user at the same time', async () => {
    const { notifications, fakePush } = await setup()

    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((name) =>
        notifications.devices.register('u1', fakePush.device(name)),
      ),
    )

    expect(await notifications.devices.list('u1')).toHaveLength(5)
  })

  it('removes a device by what identified it at registration', async () => {
    const { notifications, fakePush } = await setup()
    await notifications.devices.register('u1', fakePush.device('laptop'))

    const removed = await notifications.devices.unregister('u1', {
      kind: 'web-push',
      subscription: { endpoint: 'https://fake-push.test/send/laptop' },
    })

    expect(removed).toBe(true)
    expect(await notifications.devices.list('u1')).toEqual([])
  })

  it('moves a device to the user who registered it last', async () => {
    const { notifications, fakePush } = await setup()
    await notifications.devices.register('u1', fakePush.device('shared'))
    await notifications.devices.register('u1', fakePush.device('own'))

    await notifications.devices.register('u2', fakePush.device('shared'))

    expect(await notifications.devices.list('u1')).toHaveLength(1)
    expect(await notifications.devices.list('u2')).toHaveLength(1)
    await notifications.notify({ id: 'u1' }, reminder)
    expect(fakePush.sent.map((entry) => entry.key)).toEqual(['own'])
  })

  it('sends a notification to every device of the user', async () => {
    const { notifications, fakePush } = await setup()
    await notifications.devices.register('u1', fakePush.device('laptop'))
    await notifications.devices.register('u1', fakePush.device('phone'))
    await notifications.devices.register('u2', fakePush.device('other'))

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(fakePush.sent.map((entry) => entry.key).sort()).toEqual(['laptop', 'phone'])
    expect(fakePush.sent[0]!.payload).toEqual({
      title: 'Kick-off in an hour',
      body: 'Matchday 7',
      url: '/matchday/7',
      tag: 'kick-off',
    })
    expect(report.ok).toBe(true)
    expect(report.channels).toHaveLength(1)
    expect(report.channels[0]!.devices!.map((device) => device.status)).toEqual(['sent', 'sent'])
  })

  it('finds the devices of a user whose id is a number', async () => {
    const { notifications, fakePush } = await setup()
    await notifications.devices.register('42', fakePush.device('laptop'))

    const report = await notifications.notify({ id: 42 }, reminder)

    expect(report.channels[0]!.devices).toHaveLength(1)
  })

  it('keeps sending when one device fails, and says which one and why', async () => {
    const { notifications, fakePush } = await setup()
    const laptop = await notifications.devices.register('u1', fakePush.device('laptop'))
    const phone = await notifications.devices.register('u1', fakePush.device('phone'))
    fakePush.fail('laptop', 'the push service answered 503')

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(fakePush.sent.map((entry) => entry.key)).toEqual(['phone'])
    expect(report.ok).toBe(false)
    expect(report.channels[0]).toMatchObject({ channel: 'push', ok: false })
    expect(report.channels[0]!.devices).toEqual([
      {
        deviceId: laptop.id,
        kind: 'web-push',
        status: 'failed',
        reason: 'the push service answered 503',
      },
      { deviceId: phone.id, kind: 'web-push', status: 'sent' },
    ])
    // A failed device stays: the next notification tries it again.
    expect(await notifications.devices.list('u1')).toHaveLength(2)
  })

  it('removes a device the push service reports as gone', async () => {
    const { notifications, fakePush } = await setup()
    const laptop = await notifications.devices.register('u1', fakePush.device('laptop'))
    const phone = await notifications.devices.register('u1', fakePush.device('phone'))
    fakePush.gone('laptop')

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(report.ok).toBe(true)
    expect(report.channels[0]!.devices![0]).toMatchObject({ deviceId: laptop.id, status: 'gone' })
    expect(await notifications.devices.list('u1')).toEqual([phone])
  })

  it('removes every gone device when all of a user are gone at once', async () => {
    const { notifications, fakePush } = await setup()
    for (const name of ['a', 'b', 'c', 'd']) {
      await notifications.devices.register('u1', fakePush.device(name))
      fakePush.gone(name)
    }

    await notifications.notify({ id: 'u1' }, reminder)

    expect(await notifications.devices.list('u1')).toEqual([])
  })

  it('reports a user without devices as delivered to nobody', async () => {
    const { notifications } = await setup()

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(report).toEqual({ ok: true, channels: [{ channel: 'push', ok: true, devices: [] }] })
  })

  it('forgets every device of a user and leaves the others alone', async () => {
    const { notifications, fakePush, adapter } = await setup()
    await notifications.devices.register('u1', fakePush.device('laptop'))
    await notifications.devices.register('u1', fakePush.device('phone'))
    await notifications.devices.register('u2', fakePush.device('other'))

    expect(await notifications.devices.forget('u1')).toBe(2)

    expect(await notifications.devices.list('u1')).toEqual([])
    expect(await notifications.devices.list('u2')).toHaveLength(1)
    expect(await notifications.devices.forget('u1')).toBe(0)
    if (adapter) {
      // Nothing named after the account stays, and no owner file of its devices.
      expect(await adapter.read('push/users/u1.json')).toBeNull()
      expect(await adapter.list('push/owners')).toHaveLength(1)
    }
  })

  it('lets a forgotten device register again, for another user too', async () => {
    const { notifications, fakePush } = await setup()
    await notifications.devices.register('u1', fakePush.device('laptop'))
    await notifications.devices.forget('u1')

    await notifications.devices.register('u2', fakePush.device('laptop'))

    expect(await notifications.devices.list('u2')).toHaveLength(1)
    expect(await notifications.devices.list('u1')).toEqual([])
  })
})

describe('the device register', () => {
  function setup(drivers: PushDriver[] = [createFakePushDriver()]) {
    const store = createMemoryDeviceStore()
    return {
      notifications: createNotifications({ channels: { push: { store, drivers } } }),
      store,
    }
  }

  it('derives the id from kind and key, so it reveals neither', async () => {
    const { notifications } = setup()
    const input = {
      kind: 'web-push',
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/secret-capability' },
    }

    const device = await notifications.devices.register('u1', input)

    expect(device.id).toBe(await deviceId('web-push', input.subscription.endpoint))
    expect(device.id).not.toContain('secret')
  })

  it('refuses a device without a kind and one of a kind no driver reaches', async () => {
    const { notifications } = setup()

    await expect(
      notifications.devices.register('u1', { subscription: {} } as never),
    ).rejects.toThrow(PushDeviceError)
    await expect(
      notifications.devices.register('u1', { kind: 'apns', token: 't' }),
    ).rejects.toThrow('no push driver for devices of the kind "apns"')
    await expect(notifications.devices.register('u1', null as never)).rejects.toThrow(
      PushDeviceError,
    )
  })

  it('refuses an empty user id', async () => {
    const { notifications } = setup()
    const fakePush = createFakePushDriver()

    await expect(notifications.devices.register('', fakePush.device('a'))).rejects.toThrow(
      NotificationsError,
    )
    await expect(notifications.devices.forget('')).rejects.toThrow(NotificationsError)
  })

  it('sends each device through the driver of its kind', async () => {
    const web = createFakePushDriver()
    const apns = createFakePushDriver({ kind: 'apns' })
    const { notifications } = setup([web, apns])
    await notifications.devices.register('u1', web.device('browser'))
    await notifications.devices.register('u1', apns.device('iphone'))

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(web.sent.map((entry) => entry.key)).toEqual(['browser'])
    expect(apns.sent.map((entry) => entry.key)).toEqual(['iphone'])
    expect(report.channels[0]!.devices!.map((device) => device.kind)).toEqual(['web-push', 'apns'])
  })

  it('reports a device whose driver is no longer configured as failed and keeps it', async () => {
    const store = createMemoryDeviceStore()
    const apns = createFakePushDriver({ kind: 'apns' })
    const before = createNotifications({ channels: { push: { store, drivers: [apns] } } })
    await before.devices.register('u1', apns.device('iphone'))

    const after = createNotifications({
      channels: { push: { store, drivers: [createFakePushDriver()] } },
    })
    const report = await after.notify({ id: 'u1' }, reminder)

    expect(report.channels[0]!.devices![0]).toMatchObject({
      status: 'failed',
      reason: 'no push driver for the kind "apns"',
    })
    expect(await after.devices.list('u1')).toHaveLength(1)
  })

  it('turns what a driver throws into a failed device', async () => {
    const throwing: PushDriver = {
      kind: 'web-push',
      keyOf: () => 'k',
      targetOf: () => ({}),
      send: async () => {
        throw new Error('boom')
      },
    }
    const { notifications } = setup([throwing])
    await notifications.devices.register('u1', { kind: 'web-push' })

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(report.channels[0]!.devices![0]).toMatchObject({ status: 'failed', reason: 'boom' })
  })

  it('reports a store that cannot remove a gone device and still answers', async () => {
    const fakePush = createFakePushDriver()
    const store = createMemoryDeviceStore()
    const onError = vi.fn()
    const notifications = createNotifications({
      channels: {
        push: {
          store: { ...store, remove: async () => Promise.reject(new Error('store is down')) },
          drivers: [fakePush],
          onError,
        },
      },
    })
    await notifications.devices.register('u1', fakePush.device('laptop'))
    fakePush.gone('laptop')

    const report = await notifications.notify({ id: 'u1' }, reminder)

    expect(report.channels[0]!.devices![0]!.status).toBe('gone')
    expect(onError).toHaveBeenCalledOnce()
    expect(await notifications.devices.list('u1')).toHaveLength(1)
  })

  it('counts a push channel without toPush as a channel that threw', async () => {
    const { notifications } = setup()

    await expect(notifications.notify({ id: 'u1' }, { channels: () => ['push'] })).rejects.toThrow(
      'does not implement toPush',
    )
  })

  it('throws from the register when push is not configured', async () => {
    const notifications = createNotifications({})

    await expect(notifications.devices.list('u1')).rejects.toThrow('push is not configured')
    await expect(notifications.devices.forget('u1')).rejects.toThrow(NotificationsError)
  })

  it('refuses two drivers of one kind and a push config of the earlier shape', () => {
    const store = createMemoryDeviceStore()

    expect(() =>
      createNotifications({
        channels: { push: { store, drivers: [createFakePushDriver(), createFakePushDriver()] } },
      }),
    ).toThrow('two push drivers of the kind "web-push"')
    expect(() =>
      createNotifications({ channels: { push: { send: async () => {} } as never } }),
    ).toThrow('takes `{ store, drivers }`')
  })
})

describe('the flatdb device store', () => {
  it('refuses an adapter without conditional writes', () => {
    const adapter = {
      read: async () => null,
      write: async () => {},
      delete: async () => {},
    }

    expect(() => createFlatdbDeviceStore({ adapter })).toThrow('readVersioned/writeIf')
  })

  it('writes one file per user and one per device, under its prefix', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbDeviceStore({ adapter, prefix: '/devices/' })
    const registeredAt = new Date('2026-11-17T10:00:00Z')

    await store.put('User/1', {
      id: 'abc',
      kind: 'web-push',
      target: { endpoint: 'e' },
      registeredAt,
    })

    expect(JSON.parse((await adapter.read('devices/users/~55ser~2f1.json'))!)).toEqual({
      userId: 'User/1',
      devices: [
        {
          id: 'abc',
          kind: 'web-push',
          target: { endpoint: 'e' },
          registeredAt: registeredAt.toISOString(),
        },
      ],
    })
    expect(JSON.parse((await adapter.read('devices/owners/abc.json'))!)).toEqual({
      userId: 'User/1',
    })
    expect(await store.list('User/1')).toEqual([
      { id: 'abc', kind: 'web-push', target: { endpoint: 'e' }, registeredAt },
    ])
  })

  it('removes the owner file with the device', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbDeviceStore({ adapter })
    await store.put('u1', { id: 'abc', kind: 'web-push', target: {}, registeredAt: new Date() })

    expect(await store.remove('u1', 'abc')).toBe(true)

    expect(await adapter.read('push/owners/abc.json')).toBeNull()
    expect(await store.remove('u1', 'abc')).toBe(false)
  })

  it('says so when a file is not what the store wrote', async () => {
    const adapter = new MemoryAdapter()
    const store = createFlatdbDeviceStore({ adapter })
    await adapter.write('push/users/u1.json', JSON.stringify({ devices: [{ id: 1 }] }))

    await expect(store.list('u1')).rejects.toThrow('is not a device')
  })
})
