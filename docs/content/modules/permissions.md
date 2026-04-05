---
title: Permissions
description: Role-based access control and policy authorization
---

# Permissions

The `permissions` module provides role-based access control (RBAC) and policy-based authorization. Assign roles to users, define policies for resources, and check authorization anywhere in your application.

## Import

```ts
import { createPermissions } from '@loewen-digital/fullstack/permissions'
```

## Basic usage

```ts
import { createPermissions } from '@loewen-digital/fullstack/permissions'

const permissions = createPermissions({
  roles: {
    admin: ['*'],                              // wildcard — all actions
    editor: ['post:create', 'post:edit', 'post:delete'],
    viewer: ['post:read'],
  },
})

// Check a permission for a user with roles
const canEdit = permissions.can(user, 'post:edit') // user must have 'editor' or 'admin' role
```

## Defining policies

Policies are functions that determine whether a user can perform an action on a specific resource:

```ts
permissions.define('post', {
  edit: (user, post) => user.id === post.authorId || user.roles.includes('admin'),
  delete: (user, post) => user.roles.includes('admin'),
  publish: (user, post) => user.id === post.authorId && post.status === 'draft',
})

// Use the policy
const canEdit = await permissions.policy('post', 'edit', user, post)
```

## Gates

Simple boolean checks not tied to a specific resource:

```ts
permissions.gate('access-admin-panel', (user) => user.roles.includes('admin'))

const allowed = permissions.check('access-admin-panel', user)
```

## Throwing on unauthorized

```ts
await permissions.authorize(user, 'post:edit')
// Throws AuthorizationError if not permitted
```

## Role management

```ts
// Assign a role
await permissions.assignRole(user, 'editor')

// Remove a role
await permissions.revokeRole(user, 'editor')

// Check role membership
const isAdmin = permissions.hasRole(user, 'admin')
```

## Config options

| Option | Type | Default | Description |
|---|---|---|---|
| `roles` | `Record<string, string[]>` | `{}` | Role-to-permission mapping |
| `superAdmin` | `(user) => boolean` | — | Function that identifies super admins (bypass all checks) |
| `unauthorized` | `(user, action) => never` | throws `AuthorizationError` | Custom unauthorized handler |
