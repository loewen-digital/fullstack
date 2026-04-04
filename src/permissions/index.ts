import { ForbiddenError } from '../errors/http-errors.js'
import { PolicyRegistry } from './policies.js'
import { RoleRegistry, hasPermission } from './roles.js'
import type { PermissionsConfig, PermissionsInstance, PolicyDefinition, RoleDefinition } from './types.js'

export type {
  PermissionsConfig,
  PermissionsInstance,
  PolicyDefinition,
  PolicyHandler,
  RoleDefinition,
} from './types.js'
export { matchesPermission, hasPermission } from './roles.js'

/**
 * Create a permissions instance supporting RBAC and policy-based authorization.
 *
 * Usage:
 *   const perms = createPermissions()
 *   perms.defineRole({ name: 'admin', permissions: ['*'] })
 *   perms.defineRole({ name: 'editor', permissions: ['posts.*'], inherits: ['viewer'] })
 *   perms.assignRole(user.id, 'editor')
 *
 *   perms.definePolicy('post', {
 *     update: (user, post) => post.authorId === user.id,
 *   })
 *
 *   await perms.can(user, 'posts.create')          // RBAC check
 *   await perms.can(user, 'post.update', post)     // policy check → fallback to RBAC
 *   await perms.authorize(user, 'post.delete', post) // throws ForbiddenError if denied
 */
export function createPermissions(config?: PermissionsConfig): PermissionsInstance {
  const roleRegistry = new RoleRegistry()
  const policyRegistry = new PolicyRegistry()

  // Register roles provided in config
  for (const role of config?.roles ?? []) {
    roleRegistry.defineRole(role)
  }

  const instance: PermissionsInstance = {
    defineRole(role: RoleDefinition): void {
      roleRegistry.defineRole(role)
    },

    assignRole(userId: string | number, roleName: string): void {
      roleRegistry.assignRole(userId, roleName)
    },

    revokeRole(userId: string | number, roleName: string): void {
      roleRegistry.revokeRole(userId, roleName)
    },

    getRoles(userId: string | number): string[] {
      return roleRegistry.getRoles(userId)
    },

    hasRole(userId: string | number, roleName: string): boolean {
      return roleRegistry.hasRole(userId, roleName)
    },

    getPermissions(userId: string | number): string[] {
      return roleRegistry.getPermissions(userId)
    },

    definePolicy(resource: string, policy: PolicyDefinition): void {
      policyRegistry.definePolicy(resource, policy)
    },

    async can(user: unknown, action: string, resource?: unknown): Promise<boolean> {
      // When a resource object is provided, try policy first.
      // Action format: 'resource.method' — e.g. 'post.update', 'comment.delete'
      if (resource !== undefined) {
        const dotIndex = action.lastIndexOf('.')
        if (dotIndex !== -1) {
          const resourceType = action.slice(0, dotIndex)
          const actionName = action.slice(dotIndex + 1)
          const policyResult = await policyRegistry.check(resourceType, actionName, user, resource)
          if (policyResult !== null) return policyResult
        }
      }

      // RBAC fallback
      const userId = (user as { id?: string | number } | null)?.id
      if (userId === undefined || userId === null) return false

      const permissions = roleRegistry.getPermissions(userId)
      return hasPermission(permissions, action)
    },

    async authorize(user: unknown, action: string, resource?: unknown): Promise<void> {
      const allowed = await instance.can(user, action, resource)
      if (!allowed) {
        throw new ForbiddenError(`Not authorized to perform "${action}"`)
      }
    },
  }

  return instance
}
