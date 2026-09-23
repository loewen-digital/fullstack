/**
 * The bytes `put` received, on a plain `ArrayBuffer` of their own: a view the caller keeps
 * mutating, a `Buffer` slice of Node's pool or a `SharedArrayBuffer` view must not become what a
 * driver stores or hands out. A string is UTF-8, a stream is read to its end.
 */
export async function toBytes(data: Uint8Array | string | ReadableStream): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data)
  }
  const reader = (data as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    totalLength += value.byteLength
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
