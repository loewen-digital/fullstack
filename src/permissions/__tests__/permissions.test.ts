import { describe, it, expect, beforeEach } from 'vitest'
import { createPermissions } from '../index.js'
import { ForbiddenError } from '../../errors/http-errors.js'

describe('createPermissions', () => {
  it('creates a permissions instance', () => {
    const perms = createPermissions()
    expect(perms.can).toBeInstanceOf(Function)
    expect(perms.authorize).toBeInstanceOf(Function)
    expect(perms.defineRole).toBeInstanceOf(Function)
    expect(perms.definePolicy).toBeInstanceOf(Function)
  })

  it('registers roles from config', () => {
    const perms = createPermissions({
      roles: [{ name: 'admin', permissions: ['*'] }],
    })
    perms.assignRole('u1', 'admin')
    expect(perms.hasRole('u1', 'admin')).toBe(true)
  })
})

describe('RBAC — roles and permissions', () => {
  it('assigns and checks role', () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: ['posts.create', 'posts.update'] })
    perms.assignRole('u1', 'editor')
    expect(perms.hasRole('u1', 'editor')).toBe(true)
    expect(perms.hasRole('u1', 'admin')).toBe(false)
  })

  it('revokes a role', () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: ['posts.create'] })
    perms.assignRole('u1', 'editor')
    perms.revokeRole('u1', 'editor')
    expect(perms.hasRole('u1', 'editor')).toBe(false)
  })

  it('lists user roles', () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: [] })
    perms.defineRole({ name: 'viewer', permissions: [] })
    perms.assignRole('u1', 'editor')
    perms.assignRole('u1', 'viewer')
    expect(perms.getRoles('u1')).toEqual(expect.arrayContaining(['editor', 'viewer']))
  })

  it('throws when assigning undefined role', () => {
    const perms = createPermissions()
    expect(() => perms.assignRole('u1', 'ghost')).toThrow('Role "ghost" is not defined')
  })

  it('can() returns true for exact permission match', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: ['posts.create'] })
    perms.assignRole('u1', 'editor')
    const user = { id: 'u1' }
    expect(await perms.can(user, 'posts.create')).toBe(true)
    expect(await perms.can(user, 'posts.delete')).toBe(false)
  })

  it('can() supports wildcard permissions', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'admin', permissions: ['posts.*'] })
    perms.assignRole('u1', 'admin')
    const user = { id: 'u1' }
    expect(await perms.can(user, 'posts.create')).toBe(true)
    expect(await perms.can(user, 'posts.delete')).toBe(true)
    expect(await perms.can(user, 'users.delete')).toBe(false)
  })

  it('can() supports global wildcard *', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'superadmin', permissions: ['*'] })
    perms.assignRole('u1', 'superadmin')
    const user = { id: 'u1' }
    expect(await perms.can(user, 'anything.goes')).toBe(true)
  })

  it('can() returns false for user with no roles', async () => {
    const perms = createPermissions()
    expect(await perms.can({ id: 'u1' }, 'posts.create')).toBe(false)
  })

  it('can() returns false when user has no id', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: ['posts.create'] })
    expect(await perms.can({}, 'posts.create')).toBe(false)
    expect(await perms.can(null, 'posts.create')).toBe(false)
  })

  it('inherits permissions from parent roles', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'viewer', permissions: ['posts.read'] })
    perms.defineRole({ name: 'editor', permissions: ['posts.create'], inherits: ['viewer'] })
    perms.assignRole('u1', 'editor')
    const user = { id: 'u1' }
    expect(await perms.can(user, 'posts.read')).toBe(true)
    expect(await perms.can(user, 'posts.create')).toBe(true)
  })

  it('handles circular role inheritance gracefully', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'a', permissions: ['x'], inherits: ['b'] })
    perms.defineRole({ name: 'b', permissions: ['y'], inherits: ['a'] })
    perms.assignRole('u1', 'a')
    const user = { id: 'u1' }
    expect(await perms.can(user, 'x')).toBe(true)
    expect(await perms.can(user, 'y')).toBe(true)
  })

  it('getPermissions() returns all permissions for user', () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'viewer', permissions: ['posts.read'] })
    perms.defineRole({ name: 'editor', permissions: ['posts.create'], inherits: ['viewer'] })
    perms.assignRole('u1', 'editor')
    const permissions = perms.getPermissions('u1')
    expect(permissions).toContain('posts.read')
    expect(permissions).toContain('posts.create')
  })
})

describe('Policy-based authorization', () => {
  it('definePolicy and can() with resource', async () => {
    const perms = createPermissions()
    perms.definePolicy('post', {
      update: (user: unknown, post: unknown) =>
        (post as { authorId: string }).authorId === (user as { id: string }).id,
    })

    const user = { id: 'u1' }
    const ownPost = { id: 'p1', authorId: 'u1' }
    const otherPost = { id: 'p2', authorId: 'u2' }

    expect(await perms.can(user, 'post.update', ownPost)).toBe(true)
    expect(await perms.can(user, 'post.update', otherPost)).toBe(false)
  })

  it('policy takes precedence over RBAC when resource is provided', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'editor', permissions: ['post.update'] })
    perms.assignRole('u1', 'editor')
    perms.definePolicy('post', {
      update: (_user, post) => (post as { locked: boolean }).locked === false,
    })

    const user = { id: 'u1' }
    expect(await perms.can(user, 'post.update', { locked: false })).toBe(true)
    expect(await perms.can(user, 'post.update', { locked: true })).toBe(false)
  })

  it('falls back to RBAC when no policy matches', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'admin', permissions: ['post.delete'] })
    perms.assignRole('u1', 'admin')
    const user = { id: 'u1' }
    // post.delete has no policy defined → RBAC fallback
    expect(await perms.can(user, 'post.delete', { id: 'p1' })).toBe(true)
  })

  it('supports async policy handlers', async () => {
    const perms = createPermissions()
    perms.definePolicy('document', {
      view: async (user, _doc) => {
        // Simulate async DB lookup
        return (user as { role: string }).role === 'admin'
      },
    })

    expect(await perms.can({ role: 'admin' }, 'document.view', {})).toBe(true)
    expect(await perms.can({ role: 'guest' }, 'document.view', {})).toBe(false)
  })
})

describe('authorize()', () => {
  it('does not throw when allowed', async () => {
    const perms = createPermissions()
    perms.defineRole({ name: 'admin', permissions: ['*'] })
    perms.assignRole('u1', 'admin')
    await expect(perms.authorize({ id: 'u1' }, 'anything')).resolves.toBeUndefined()
  })

  it('throws ForbiddenError when denied', async () => {
    const perms = createPermissions()
    await expect(perms.authorize({ id: 'u1' }, 'posts.delete')).rejects.toThrow(ForbiddenError)
  })

  it('ForbiddenError contains the action name', async () => {
    const perms = createPermissions()
    try {
      await perms.authorize({ id: 'u1' }, 'posts.delete')
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError)
      expect((err as ForbiddenError).message).toContain('posts.delete')
    }
  })
})
