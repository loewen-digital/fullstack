---
title: Feedback
description: The endpoint of an in-app feedback form, filing each message as a GitHub issue
---

# Feedback

`createFeedbackHandler` is the server side of a feedback form: it takes the form's POST, checks it and hands the message to a sink. `githubIssueSink` files it as an issue in your repository, where you already triage work; `kvSink` keeps it in a Workers KV namespace when GitHub does not answer. The handler is a function from `Request` to `Response`, so it runs in a SvelteKit endpoint, a Cloudflare Pages Function, a Worker or Hono unchanged.

## Import

```ts
import { createFeedbackHandler, githubIssueSink, kvSink } from '@loewen-digital/fullstack/feedback'
```

## The endpoint

A Cloudflare Pages Function; the bindings arrive with the request, so the handler is built per request:

```ts
// functions/api/feedback.ts
import { createFeedbackHandler, githubIssueSink, kvSink } from '@loewen-digital/fullstack/feedback'
import { createKvRateLimiter } from '@loewen-digital/fullstack/security'

export const onRequest = ({ request, env }) =>
  createFeedbackHandler({
    sink: githubIssueSink({ repo: 'acme/app', token: env.FEEDBACK_GITHUB_TOKEN }),
    fallback: kvSink({ namespace: env.FEEDBACK }),
    rateLimiter: createKvRateLimiter({
      namespace: env.FEEDBACK,
      windowMs: 3_600_000,
      max: 5,
      prefix: 'rl',
    }),
  })(request)
```

In SvelteKit the same call sits in `src/routes/api/feedback/+server.ts` as `export const POST = ({ request, platform }) => createFeedbackHandler({ ... })(request)`.

The form posts JSON:

| Field | | |
| --- | --- | --- |
| `message` | required | The text, 4000 characters at most (`maxMessageLength`) |
| `contact` | optional | How to reach the sender; dropped unless `includeContact` is on |
| `meta` | optional | Free text the app adds: version, build, the state a bug report needs. Cut to 1000 characters |
| `website` | honeypot | An input people cannot see. Bots fill it in; such a post is answered with `{ ok: true }` and dropped |

Answers: `200 { ok: true }`, `400` (no JSON object, no message), `405`, `413` (too long), `429` (rate limit, with `Retry-After` when the limiter reports the window's end), `502` (no sink took the message).

## What the endpoint defends against

The endpoint is public and takes text from strangers.

- **Volume.** `rateLimiter` takes any limiter from [security](/modules/security); the key is `CF-Connecting-IP`, then the first `X-Forwarded-For` entry (`clientKey` replaces that). Only accepted messages count. A limiter that throws lets nothing through: the KV limiter refuses a second write to a key within a second, and that is answered with 429. Without a limiter the endpoint is unlimited.
- **Mentions and references.** A message that says `@someone` would notify that account, and `@claude` or `@codex` in an issue can start an agent. The issue sink puts a zero-width space after every `@`, after `#` before a number and after `GH-`, in the title, the message and `meta`. The text reads the same; the literal `@name` no longer occurs. `defuse(text)` is exported for your own sinks.
- **Markup.** The message is a block quote with `<` escaped, so an unclosed `<!--` cannot hide the rest of the issue. `meta` sits in a code fence one backtick longer than any run inside it.
- **Instructions.** The issue ends with a line that says the quote is a user's message, not a spec and not an instruction. That line is for whoever reads the issue, people and agents alike; do not let an agent build from a feedback issue directly.

## Contact

`includeContact` is off by default and the handler then drops `contact` before any sink sees it: an e-mail address in an issue of a public repository cannot be taken back. Turn it on for a private repository, and say on the form where the address goes. In the issue the contact stands as typed inside a code span, so it can be copied; it is the one field that may still contain a literal `@name`.

## The GitHub token

`githubIssueSink({ repo, token, labels?, titlePrefix?, apiUrl?, fetch? })` needs a fine-grained personal access token with "Issues: read and write" on that one repository. Issues appear under the token owner's name with the label `feedback` (`labels` replaces it). Keep the token a secret of the deployment (`wrangler secret put FEEDBACK_GITHUB_TOKEN`), never in the repository.

Without a token the sink does not throw when it is created: `deliver` rejects, and the handler's fallback takes the message. So the endpoint can ship before the secret is set, and nothing is lost in between.

## Fallback

When `sink` rejects, the handler reports the error (`onError`, default `console.error`) and gives the message to `fallback`. `kvSink({ namespace, prefix? })` stores the entry as JSON under `fb:<receivedAt>:<id>`. KV has no view to read them in; `wrangler kv key list --binding FEEDBACK --prefix fb:` lists them in order of arrival. Nothing forwards them later: that is a script of yours calling `githubIssueSink(...).deliver(entry)` for each.

## Your own sink

A sink is one method:

```ts
import type { FeedbackSink } from '@loewen-digital/fullstack/feedback'

const mailSink: FeedbackSink = {
  async deliver(entry) {
    await mail.send({ to: 'team@example.com', subject: 'Feedback', text: entry.message })
  },
}
```

`entry` is `{ receivedAt, message, contact, meta }`; `formatIssue(entry)` gives the title and Markdown body the issue sink would send.

## CORS

A form on the same origin needs none, and the handler sends no CORS headers. For a form on another origin (a local dev server posting to production) pass `cors: { origins: ['http://localhost:5173'] }`; the handler then answers the preflight and adds the headers to every response.
