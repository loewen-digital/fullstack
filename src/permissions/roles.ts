import type { RoleDefinition } from './types.js'

export class RoleRegistry {
  private roles = new Map<string, RoleDefinition>()
  private userRoles = new Map<string | number, Set<string>>()

  defineRole(role: RoleDefinition): void {
    this.roles.set(role.name, role)
  }

  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name)
  }

  assignRole(userId: string | number, roleName: string): void {
    if (!this.roles.has(roleName)) {
      throw new Error(`Role "${roleName}" is not defined`)
    }
    const set = this.userRoles.get(userId) ?? new Set<string>()
    set.add(roleName)
    this.userRoles.set(userId, set)
  }

  revokeRole(userId: string | number, roleName: string): void {
    this.userRoles.get(userId)?.delete(roleName)
  }

  getRoles(userId: string | number): string[] {
    return [...(this.userRoles.get(userId) ?? [])]
  }

  hasRole(userId: string | number, roleName: string): boolean {
    return this.userRoles.get(userId)?.has(roleName) ?? false
  }

  getPermissions(userId: string | number): string[] {
    const roleNames = this.getRoles(userId)
    const permissions = new Set<string>()
    for (const name of roleNames) {
      this.collectPermissions(name, permissions, new Set())
    }
    return [...permissions]
  }

  private collectPermissions(
    roleName: string,
    permissions: Set<string>,
    visited: Set<string>,
  ): void {
    if (visited.has(roleName)) return
    visited.add(roleName)

    const role = this.roles.get(roleName)
    if (!role) return

    for (const perm of role.permissions) {
      permissions.add(perm)
    }

    for (const inherited of role.inherits ?? []) {
      this.collectPermissions(inherited, permissions, visited)
    }
  }
}

/**
 * Returns true if `permission` grants `action`.
 * Supports exact match, wildcard prefix (posts.*), and global wildcard (*).
 */
export function matchesPermission(permission: string, action: string): boolean {
  if (permission === '*') return true
  if (permission === action) return true
  if (permission.endsWith('.*')) {
    const prefix = permission.slice(0, -2)
    return action === prefix || action.startsWith(`${prefix}.`)
  }
  return false
}

export function hasPermission(permissions: string[], action: string): boolean {
  return permissions.some((p) => matchesPermission(p, action))
}
