import type { IncomingVerifyOptions, IncomingVerifyResult, SignatureAlgorithm } from './types.js'

/**
 * Convert a Uint8Array to a lowercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function algorithmName(alg: SignatureAlgorithm): string {
  return alg === 'hmac-sha256' ? 'SHA-256' : 'SHA-1'
}

/**
 * Verify an incoming webhook signature using Web Crypto.
 *
 * Supports HMAC-SHA256 and HMAC-SHA1.
 * Compares signatures in constant time to prevent timing attacks.
 */
export async function verifyIncomingWebhook(
  request: Request,
  options: IncomingVerifyOptions,
): Promise<IncomingVerifyResult> {
  const { secret, header, algorithm = 'hmac-sha256', prefix = '' } = options

  // Read and clone the body (so the caller can still read it after verification)
  const bodyBytes = new Uint8Array(await request.clone().arrayBuffer())

  const rawSignature = request.headers.get(header)
  if (!rawSignature) {
    return { valid: false, reason: `Missing signature header: ${header}` }
  }

  const signatureHex = rawSignature.startsWith(prefix)
    ? rawSignature.slice(prefix.length)
    : rawSignature

  // Import the HMAC key
  const keyData = new TextEncoder().encode(secret)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithmName(algorithm) },
    false,
    ['sign'],
  )

  // Compute expected signature
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyBytes)
  const expectedHex = bytesToHex(new Uint8Array(signatureBuffer))

  // Constant-time comparison
  const expectedBytes = new TextEncoder().encode(expectedHex)
  const actualBytes = new TextEncoder().encode(signatureHex.toLowerCase())

  if (expectedBytes.length !== actualBytes.length) {
    return { valid: false, reason: 'Signature length mismatch' }
  }

  let mismatch = 0
  for (let i = 0; i < expectedBytes.length; i++) {
    mismatch |= (expectedBytes[i] ?? 0) ^ (actualBytes[i] ?? 0)
  }

  if (mismatch !== 0) {
    return { valid: false, reason: 'Signature mismatch' }
  }

  return { valid: true }
}

/**
 * Convenience: compute the HMAC-SHA256 signature for a payload.
 * Useful when generating test signatures.
 */
export async function signPayload(
  payload: string | Uint8Array,
  secret: string,
  algorithm: SignatureAlgorithm = 'hmac-sha256',
): Promise<string> {
  const keyData = new TextEncoder().encode(secret)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: algorithmName(algorithm) },
    false,
    ['sign'],
  )

  const data: BufferSource =
    typeof payload === 'string' ? new TextEncoder().encode(payload) : payload.buffer as ArrayBuffer

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return bytesToHex(new Uint8Array(signatureBuffer))
}
