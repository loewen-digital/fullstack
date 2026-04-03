// Events types — Task 2.3

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap = Record<string, any>

export type EventListener<T> = (payload: T) => void | Promise<void>

export interface EventBusInstance<Events extends EventMap = EventMap> {
  emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void>
  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void
  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void
  once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void
}
