// Permissions module types

export interface PermissionsConfig {
  /** Pre-defined roles to register on creation */
  roles?: RoleDefinition[]
}

export interface RoleDefinition {
  name: string
  /** Permission strings, supports wildcards: 'posts.*', '*' */
  permissions: string[]
  /** Role names whose permissions this role inherits */
  inherits?: string[]
}

export type PolicyHandler<TUser = unknown, TResource = unknown> = (
  user: TUser,
  resource: TResource,
) => boolean | Promise<boolean>

export interface PolicyDefinition {
  [action: string]: PolicyHandler
}

export interface PermissionsInstance {
  // ── Role management ─────────────────────────────────────────────────────────
  defineRole(role: RoleDefinition): void
  assignRole(userId: string | number, roleName: string): void
  revokeRole(userId: string | number, roleName: string): void
  getRoles(userId: string | number): string[]
  hasRole(userId: string | number, roleName: string): boolean
  getPermissions(userId: string | number): string[]

  // ── Policy management ────────────────────────────────────────────────────────
  definePolicy(resource: string, policy: PolicyDefinition): void

  // ── Permission checks ────────────────────────────────────────────────────────
  /** Returns true if the user is allowed to perform the action.
   *  - With a resource: tries policy first (action = 'resource.method'), falls back to RBAC.
   *  - Without a resource: RBAC check only.
   */
  can(user: unknown, action: string, resource?: unknown): Promise<boolean>

  /** Like can(), but throws ForbiddenError when denied. */
  authorize(user: unknown, action: string, resource?: unknown): Promise<void>
}
