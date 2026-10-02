# 0017 · Fetch adapter: a result object, Secure by default, shared cookie code

## Context

#32 asks for an adapter for handlers that get a `Request` and return a `Response` (Pages Functions, Workers,
Hono): `sessionOf(request)` answering the session "or null plus the Set-Cookie header that clears it",
`setAuthCookie(headers, token)` with "Secure on HTTPS", and proposes to extract the cookie code of the four
adapters into it and let the SvelteKit adapter call it.

## Decision

`sessionOf` returns `{ session, clearCookie }`: a middleware has no response headers yet when it asks, so the
deleting cookie travels as a value. `setAuthCookie` and `clearAuthCookie` see headers, not the request, and
cannot detect HTTPS: the cookie is `Secure` unless `secure` (options or per call) says otherwise, and
`isSecureRequest(request)` supplies the value for local HTTP. `isSameOrigin` and `isSecureRequest` are plain
exports, they need no auth. SvelteKit and Astro use their framework's cookie API and share nothing; the copies
were in Remix and Nuxt, which now import `src/adapters/cookies.ts` together with the fetch adapter.

## Consequences

An app that forgets `secure` gets a cookie that fails closed on plain HTTP instead of one that travels
unencrypted. A malformed percent-encoding in a `Cookie` header no longer throws in Remix and Nuxt.
