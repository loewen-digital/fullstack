import type { CorsConfig, RateLimiter } from '../security/types.js'

/** One message from a feedback form, as a sink receives it */
export interface FeedbackEntry {
  /** ISO timestamp of the moment the handler accepted the message */
  receivedAt: string
  message: string
  /** How to reach the sender; `null` unless the handler runs with `includeContact` */
  contact: string | null
  /** What the app sent along (version, build, state), free text */
  meta: string | null
}

/** Where an accepted message goes: a GitHub issue, a KV namespace, your own store */
export interface FeedbackSink {
  deliver(entry: FeedbackEntry): Promise<void>
}

export interface FeedbackHandlerConfig {
  /** Where messages go */
  sink: FeedbackSink
  /** Takes the message when `sink` rejects, so an outage of the first store loses nothing */
  fallback?: FeedbackSink
  /** Counts one hit per accepted message and client; without one the endpoint is unlimited */
  rateLimiter?: RateLimiter
  /**
   * Keep the `contact` field (default: false). Off, the handler drops it before any sink sees
   * it: a sink that writes somewhere public would publish an address that cannot be taken back.
   */
  includeContact?: boolean
  /** Longest message in characters (default: 4000); a longer one is answered with 413 */
  maxMessageLength?: number
  /** `contact` is cut to this many characters (default: 200) */
  maxContactLength?: number
  /** `meta` is cut to this many characters (default: 1000) */
  maxMetaLength?: number
  /** CORS for a form on another origin; absent, the handler sends no CORS headers */
  cors?: CorsConfig
  /** The rate limit key of a request (default: `CF-Connecting-IP`, then `X-Forwarded-For`) */
  clientKey?: (request: Request) => string
  /** Called with what a sink threw (default: `console.error`) */
  onError?: (error: unknown) => void
}

export type FeedbackHandler = (request: Request) => Promise<Response>

export interface GithubIssueSinkConfig {
  /** The repository that gets the issues, as `owner/name` */
  repo: string
  /** A token with "Issues: read and write" on that repository; without one `deliver` rejects */
  token: string | undefined
  /** Labels of the issue (default: `['feedback']`) */
  labels?: string[]
  /** What the issue title starts with (default: `'Feedback: '`) */
  titlePrefix?: string
  /** The `fetch` to call GitHub with (default: the global one) */
  fetch?: (input: string, init: RequestInit) => Promise<Response>
  /** Base URL of the API (default: `https://api.github.com`), for GitHub Enterprise */
  apiUrl?: string
}

/** The part of a Workers KV namespace the sink uses */
export interface FeedbackKvNamespace {
  put(key: string, value: string): Promise<void>
}

export interface KvSinkConfig {
  namespace: FeedbackKvNamespace
  /** Prefix of the keys (default: 'fb'); an entry is stored as `prefix:receivedAt:id` */
  prefix?: string
}
