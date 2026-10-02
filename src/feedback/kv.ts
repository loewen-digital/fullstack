import type { FeedbackEntry, FeedbackSink, KvSinkConfig } from './types.js'

/**
 * A sink that stores every message as JSON in a Workers KV namespace, one key per message
 * (`fb:<receivedAt>:<id>`, so a key listing is in order of arrival). Meant as the fallback of a
 * handler: KV has no view for reading messages, only `wrangler kv key list` and `get`.
 */
export function kvSink(config: KvSinkConfig): FeedbackSink {
  const prefix = config.prefix ?? 'fb'

  return {
    async deliver(entry: FeedbackEntry): Promise<void> {
      const id = crypto.randomUUID().slice(0, 8)
      await config.namespace.put(`${prefix}:${entry.receivedAt}:${id}`, JSON.stringify(entry))
    },
  }
}
