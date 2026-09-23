# 0012 · Storage drivers read a stream into memory before an upload

## Context

`put` takes a `ReadableStream` (#28). S3 rejects a chunked PUT: it wants `Content-Length` and, short of
`aws-chunked` signing, the payload hash before the first byte. R2's bucket binding rejects a stream whose
length it cannot tell; a `new ReadableStream` built in app code has none, `request.body` and
`FixedLengthStream` have. Options: read the stream into memory; require `contentLength` in `FileMeta`
and stream through where the runtime allows it; multipart upload.

## Decision

All three drivers read the stream to its end first (`toBytes`, shared with the memory driver) and upload
the bytes. One path, hashed and signed like any other body, working on every runtime. A `File` from a
form fits a Worker's memory whenever it fit the request that carried it.

## Consequences

An upload costs its size in memory and never streams, even where the runtime could. Multipart upload is
the answer for anything larger and stays out of #28, an issue of its own when an app needs it. The R2
driver over the S3 API is the S3 driver with region `auto` and path-style URLs, as the issue proposed.
