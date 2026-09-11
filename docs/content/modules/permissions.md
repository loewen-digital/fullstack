---
title: Permissions
description: Roles with wildcard permissions and inheritance, policies per resource, one can() for both
---

# Permissions

`createPermissions` answers `can(user, action, resource?)`. Roles map names to permission strings with wildcards and can inherit from each other; policies are functions per resource and action that see the object in question. With a resource, `can` asks the policy first and falls back to the roles; without one, only the roles decide. `authorize` is `can` that throws.

## Import

```ts
import { createPermissions } from '@loewen-digital/fullstack/permissions'
```

## Roles

Roles are defined up front or with `defineRole`; users get roles by id with `assignRole`. A permission string is exact (`posts.create`), a prefix wildcard (`posts.*` matches `posts` and `posts.anything`) or `*`. `inherits` pulls in another role's permissions, transitively.

```ts
import { createPermissions } from '@loewen-digital/fullstack/permissions'

export const permissions = createPermissions({
  roles: [
    { name: 'viewer', permissions: ['posts.read', 'comments.read'] },
    { name: 'editor', permissions: ['posts.*'], inherits: ['viewer'] },
    { name: 'admin', permissions: ['*'] },
  ],
})

permissions.assignRole(42, 'editor') // throws for an undefined role
permissions.getRoles(42) // ['editor']
permissions.getPermissions(42) // ['posts.*', 'posts.read', 'comments.read']
permissions.hasRole(42, 'admin') // false
permissions.revokeRole(42, 'editor')
```

Assignments live in memory on the instance. In a request cycle, assign the roles from your user record before checking, or build an instance per request.

## Checking

`can` reads `user.id` for the role lookup; a user without an `id` has no permissions.

```ts
async function checks() {
  const user = { id: 42, name: 'Alice' }
  permissions.assignRole(user.id, 'editor')

  const canCreate = await permissions.can(user, 'posts.create') // true via posts.*
  const canDeleteComments = await permissions.can(user, 'comments.delete') // false
  return { canCreate, canDeleteComments }
}
```

## Policies

`definePolicy(resource, handlers)` registers one function per action; each gets the user and the resource object and may be async. `can(user, 'post.update', post)` runs `handlers.update` when a policy for `post` has it, and its answer is final. Without a matching policy or action, the roles decide as above.

```ts
type Post = { id: number; authorId: number; status: 'draft' | 'published' }
type User = { id: number }

permissions.definePolicy('post', {
  update: (user, post) => (post as Post).authorId === (user as User).id,
  publish: (user, post) => (post as Post).authorId === (user as User).id && (post as Post).status === 'draft',
})

async function edit(user: User, post: Post) {
  if (!(await permissions.can(user, 'post.update', post))) return null
  return post
}
```

The action's last dot splits resource and action: `post.update` is resource `post`, action `update`; `blog.post.update` is resource `blog.post`.

## Authorize

`authorize` throws a `ForbiddenError` (status 403) instead of returning `false`; `errorToResponse` from the errors module turns it into a response.

```ts
import { errorToResponse } from '@loewen-digital/fullstack/errors'

async function remove(user: User, post: Post): Promise<Response> {
  try {
    await permissions.authorize(user, 'post.delete', post)
    return new Response(null, { status: 204 })
  } catch (err) {
    return errorToResponse(err) // 403 for ForbiddenError
  }
}
```

## Standalone matching

`matchesPermission(permission, action)` and `hasPermission(permissions, action)` are the wildcard rules without an instance, for permission lists you store yourself.

```ts
import { hasPermission } from '@loewen-digital/fullstack/permissions'

const allowed = hasPermission(['posts.*'], 'posts.publish') // true
```

## Config options

`createPermissions(config?)` reads one option.

| Option | Type | Default | Description |
|---|---|---|---|
| `roles` | `RoleDefinition[]` | `[]` | Roles registered on creation: `{ name, permissions, inherits? }` |
