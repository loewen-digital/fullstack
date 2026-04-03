// Events module — Task 2.3

import type { EventMap, EventListener, EventBusInstance } from './types.js'

export type { EventMap, EventListener, EventBusInstance } from './types.js'

/**
 * Define the event map shape for a typed event bus.
 *
 * @example
 * const events = defineEvents<{ 'user.created': User; 'post.published': Post }>()
 * const bus = createEventBus<typeof events>()
 */
export function defineEvents<Events extends EventMap>(): Events {
  // Runtime no-op — purely a TypeScript helper to capture the event map type.
  return {} as Events
}

export function createEventBus<Events extends EventMap = EventMap>(): EventBusInstance<Events> {
  const listeners = new Map<keyof Events, Set<EventListener<unknown>>>()

  function getSet(event: keyof Events): Set<EventListener<unknown>> {
    let set = listeners.get(event)
    if (!set) {
      set = new Set()
      listeners.set(event, set)
    }
    return set
  }

  return {
    async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
      const set = listeners.get(event)
      if (!set) return

      const errors: unknown[] = []
      for (const listener of [...set]) {
        try {
          await listener(payload)
        } catch (err) {
          errors.push(err)
        }
      }

      if (errors.length > 0) {
        // Re-throw the first error after all listeners have run
        throw errors[0]
      }
    },

    on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
      getSet(event).add(listener as EventListener<unknown>)
      return () => { getSet(event).delete(listener as EventListener<unknown>) }
    },

    off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
      listeners.get(event)?.delete(listener as EventListener<unknown>)
    },

    once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
      const wrapper: EventListener<Events[K]> = async (payload) => {
        getSet(event).delete(wrapper as EventListener<unknown>)
        await listener(payload)
      }
      getSet(event).add(wrapper as EventListener<unknown>)
      return () => { getSet(event).delete(wrapper as EventListener<unknown>) }
    },
  }
}
