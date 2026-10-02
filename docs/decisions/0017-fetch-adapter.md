# 0017 · Fetch adapter: a result object, Secure by default, shared cookie code

## Context

#32 asks for an adapter for plain fetch handlers: `sessionOf(request)` answering the session "or null plus
the Set-Cookie header that clears it", `setAuthCookie(headers, token)` with "Secure on HTTPS", and proposes
to extract the four adapters' cookie code into it and let the SvelteKit adapter call it.

## Decision

`sessionOf` returns `{ session, clearCookie }`: a middleware has no response headers yet when it asks. The
cookie writers see headers, not the request, and cannot detect HTTPS: the cookie is `Secure` unless `secure`
says otherwise, and `isSecureRequest(request)` supplies the value for local HTTP. `isSameOrigin` is a plain
export, it needs no auth. SvelteKit and Astro use their framework's cookie API; the copies were in Remix and
Nuxt, which now share `src/adapters/cookies.ts` with the fetch adapter.

## Consequences

An app that forgets `secure` gets a cookie that fails closed on plain HTTP instead of one that travels
unencrypted. A malformed percent-encoding in a `Cookie` header no longer throws in Remix and Nuxt.
