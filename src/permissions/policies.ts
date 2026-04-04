import type { PolicyDefinition } from './types.js'

export class PolicyRegistry {
  private policies = new Map<string, PolicyDefinition>()

  definePolicy(resource: string, policy: PolicyDefinition): void {
    this.policies.set(resource, policy)
  }

  hasPolicy(resource: string): boolean {
    return this.policies.has(resource)
  }

  /**
   * Runs the policy handler for (resource, action).
   * Returns null if no policy or handler is registered (so the caller can fall back to RBAC).
   */
  async check(
    resource: string,
    action: string,
    user: unknown,
    resourceObj: unknown,
  ): Promise<boolean | null> {
    const policy = this.policies.get(resource)
    if (!policy) return null

    const handler = policy[action]
    if (!handler) return null

    return handler(user, resourceObj)
  }
}
