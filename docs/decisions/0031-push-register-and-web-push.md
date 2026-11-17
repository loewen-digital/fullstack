# 0031 · Notifications: a register of devices, a driver per kind, Web Push without a dependency

## Context

#50 wants `notify()` to reach every browser of a user, on Node and on Workers. It names
`@block65/webcrypto-web-push`, which anspiel uses, and leaves the choice to the builder.

## Decision

RFC 8291 and 8292 are implemented on Web Crypto and checked against the RFC's example: the
package keeps zero dependencies, as with SigV4. The register lives in the module; a driver reaches
the devices of one `kind` and answers `sent`, `gone` or `failed`, so APNs becomes a second driver.
A device id is a hash of kind and endpoint and belongs to one user: another registration moves it.
The driver takes endpoints of the browsers' push services only (`endpointHosts`): the server posts
to a URL a client names. `notify()` returns a report and throws as before.

## Consequences

`PushDriver` and `channels.push` change shape; `deps.push` is gone. A push service that is not on
the list is added by config. The flatdb store keeps an owner file per device beside a file per user.
