/**
 * Verifies what the App Store signs: a JWS (ES256) whose header carries the certificate chain of
 * the key that signed it. The checks are those of Apple's own server library: the chain leads to
 * a trusted root, the certificates carry Apple's markers and were valid when the data was signed,
 * and the signature is the leaf's. Web Crypto only, so it runs on Node and on Cloudflare Workers.
 *
 * It reads as much of X.509 as that takes and no more: it is not a general certificate
 * validator, and it asks no revocation service.
 */

/** Thrown for anything that is not a JWS the App Store signed. The message never carries the data */
export class AppleSignatureError extends Error {
  override name = 'AppleSignatureError'
}

/** Apple Root CA - G3 in DER, as base64: the root of everything the App Store signs */
export const APPLE_ROOT_CA_G3 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA=='

/** How far a certificate's validity may be off the time of the signature, as in Apple's library */
const MAX_SKEW = 60_000
/** A notification with its two signed parts stays far below this */
const MAX_JWS_LENGTH = 200_000

const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  ecdsaWithSha384: '1.2.840.10045.4.3.3',
  basicConstraints: '2.5.29.19',
  /** Marks the certificate the App Store signs receipts and transactions with */
  appleReceiptSigning: '1.2.840.113635.100.6.11.1',
  /** Marks an intermediate of Apple Worldwide Developer Relations */
  appleDeveloperRelations: '1.2.840.113635.100.6.2.1',
} as const

type Bytes = Uint8Array<ArrayBuffer>
type Curve = 'P-256' | 'P-384'
type Hash = 'SHA-256' | 'SHA-384'

/** What the verification reads of an X.509 certificate */
export interface Certificate {
  /** The part that is signed, as it was signed */
  tbs: Bytes
  /** The issuer's signature over `tbs`, as `r || s` */
  signature: { r: Bytes; s: Bytes }
  hash: Hash
  /** The names in DER; a certificate is its issuer's when they are the same bytes */
  issuer: Bytes
  subject: Bytes
  notBefore: number
  notAfter: number
  /** The public key in the form Web Crypto imports */
  spki: Bytes
  curve: Curve
  /** Whether the certificate may sign certificates */
  ca: boolean
  /** The ids of the extensions it carries */
  extensions: ReadonlySet<string>
}

function fail(what: string): never {
  throw new AppleSignatureError(what)
}

/** One element of DER: its tag and where its content lies in the bytes */
interface Element {
  tag: number
  /** Where the element starts, with tag and length */
  at: number
  start: number
  end: number
}

function element(bytes: Bytes, at: number, limit: number): Element {
  if (at + 2 > limit) fail('a certificate is cut off')
  const tag = bytes[at]!
  // No certificate uses the long form of a tag.
  if ((tag & 0x1f) === 0x1f) fail('a certificate is not DER')
  let length = bytes[at + 1]!
  let start = at + 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (count === 0 || count > 3 || start + count > limit) fail('a certificate is not DER')
    length = 0
    for (let index = 0; index < count; index++) length = length * 256 + bytes[start + index]!
    start += count
  }
  if (start + length > limit) fail('a certificate is cut off')
  return { tag, at, start, end: start + length }
}

function children(bytes: Bytes, parent: Element): Element[] {
  const found: Element[] = []
  for (let at = parent.start; at < parent.end;) {
    const child = element(bytes, at, parent.end)
    found.push(child)
    at = child.end
  }
  return found
}

const SEQUENCE = 0x30

function sequence(bytes: Bytes, value: Element | undefined): Element[] {
  if (value?.tag !== SEQUENCE) fail('a certificate is not built as X.509')
  return children(bytes, value)
}

function oid(bytes: Bytes, value: Element | undefined): string {
  if (value?.tag !== 0x06 || value.end === value.start) fail('a certificate is not built as X.509')
  const arcs: number[] = []
  let arc = 0
  for (let index = value.start; index < value.end; index++) {
    arc = arc * 128 + (bytes[index]! & 0x7f)
    if (!(bytes[index]! & 0x80)) {
      arcs.push(arc)
      arc = 0
    }
  }
  const first = Math.min(Math.floor(arcs[0]! / 40), 2)
  return [first, arcs[0]! - first * 40, ...arcs.slice(1)].join('.')
}

/** `UTCTime` or `GeneralizedTime`, in the one form DER allows: to the second, in UTC */
function time(bytes: Bytes, value: Element | undefined): number {
  const digits = value?.tag === 0x17 ? 2 : value?.tag === 0x18 ? 4 : 0
  const text = value ? String.fromCharCode(...bytes.subarray(value.start, value.end)) : ''
  const match = new RegExp(`^(\\d{${digits}})(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)(\\d\\d)Z$`).exec(text)
  if (digits === 0 || !match) fail('a certificate has no valid dates')
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as number[]
  // Two digits mean 1950 to 2049.
  const century = digits === 4 ? 0 : year! >= 50 ? 1900 : 2000
  return Date.UTC(century + year!, month! - 1, day, hour, minute, second)
}

/** The number inside a DER `INTEGER`, at the width of the curve */
function unsigned(bytes: Bytes, value: Element | undefined, size: number): Bytes {
  if (value?.tag !== 0x02) fail('a signature is not built as ECDSA')
  let start = value.start
  while (start < value.end - 1 && bytes[start] === 0) start++
  if (value.end - start > size) fail('a signature does not fit its curve')
  const padded = new Uint8Array(size)
  padded.set(bytes.subarray(start, value.end), size - (value.end - start))
  return padded
}

/** Reads a certificate in DER. Throws `AppleSignatureError` for anything else */
export function parseCertificate(der: Bytes): Certificate {
  const outer = element(der, 0, der.length)
  if (outer.end !== der.length) fail('a certificate has bytes after its end')
  const [tbs, algorithm, signatureBits, ...rest] = sequence(der, outer)
  if (!tbs || !algorithm || signatureBits?.tag !== 0x03 || rest.length > 0) {
    fail('a certificate is not built as X.509')
  }

  const fields = sequence(der, tbs)
  // The version comes first and is left out by a certificate of version 1.
  let index = fields[0]?.tag === 0xa0 ? 1 : 0
  index++ // the serial number
  const inner = fields[index++]
  const issuer = fields[index++]
  const validity = sequence(der, fields[index++])
  const subject = fields[index++]
  const keyInfo = fields[index++]
  const extensionList = fields.slice(index).find((field) => field.tag === 0xa3)
  if (inner?.tag !== SEQUENCE || issuer?.tag !== SEQUENCE || subject?.tag !== SEQUENCE) {
    fail('a certificate is not built as X.509')
  }
  // What the signature covers has to name the algorithm the signature names.
  if (!sameBytes(der.subarray(inner.at, inner.end), der.subarray(algorithm.at, algorithm.end))) {
    fail('a certificate names two signature algorithms')
  }

  const signatureOid = oid(der, sequence(der, algorithm)[0])
  const hash: Hash | undefined =
    signatureOid === OID.ecdsaWithSha256
      ? 'SHA-256'
      : signatureOid === OID.ecdsaWithSha384
        ? 'SHA-384'
        : undefined
  if (!hash) fail('a certificate is not signed with ECDSA on SHA-256 or SHA-384')

  const [keyAlgorithm, keyBits] = sequence(der, keyInfo)
  const [keyType, keyCurve] = sequence(der, keyAlgorithm)
  const curveOid = oid(der, keyCurve)
  const curve: Curve | undefined =
    curveOid === OID.p256 ? 'P-256' : curveOid === OID.p384 ? 'P-384' : undefined
  if (oid(der, keyType) !== OID.ecPublicKey || !curve || keyBits?.tag !== 0x03) {
    fail('a certificate has no key on P-256 or P-384')
  }

  // A bit string starts with the number of unused bits; a signature has none.
  if (der[signatureBits.start] !== 0) fail('a signature is not built as ECDSA')
  const signature = der.slice(signatureBits.start + 1, signatureBits.end)
  const [r, s, ...more] = sequence(signature, element(signature, 0, signature.length))
  if (more.length > 0) fail('a signature is not built as ECDSA')
  // The width is the issuer's curve, which is not known here: the widest one holds both.
  const width = 48

  const extensions = new Set<string>()
  let ca = false
  if (extensionList) {
    for (const extension of sequence(der, children(der, extensionList)[0])) {
      const parts = sequence(der, extension)
      const id = oid(der, parts[0])
      extensions.add(id)
      if (id !== OID.basicConstraints) continue
      const value = parts[parts.length - 1]
      if (value?.tag !== 0x04) fail('a certificate is not built as X.509')
      const flag = sequence(der, element(der, value.start, value.end))[0]
      ca = flag?.tag === 0x01 && flag.end - flag.start === 1 && der[flag.start] !== 0
    }
  }

  return {
    tbs: der.slice(tbs.at, tbs.end),
    signature: { r: unsigned(signature, r, width), s: unsigned(signature, s, width) },
    hash,
    issuer: der.slice(issuer.at, issuer.end),
    subject: der.slice(subject.at, subject.end),
    notBefore: time(der, validity[0]),
    notAfter: time(der, validity[1]),
    spki: der.slice(keyInfo!.at, keyInfo!.end),
    curve,
    ca,
    extensions,
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/** Whether `issuer` issued `certificate`: the names match and the signature is the issuer's */
async function issuedBy(certificate: Certificate, issuer: Certificate): Promise<boolean> {
  if (!sameBytes(certificate.issuer, issuer.subject)) return false
  const size = issuer.curve === 'P-256' ? 32 : 48
  const { r, s } = certificate.signature
  // Read at the widest curve: what stands in front of the issuer's width has to be zero.
  const lead = r.length - size
  if ([...r.subarray(0, lead), ...s.subarray(0, lead)].some((byte) => byte !== 0)) return false
  const signature = new Uint8Array(size * 2)
  signature.set(r.subarray(lead))
  signature.set(s.subarray(lead), size)
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      issuer.spki,
      { name: 'ECDSA', namedCurve: issuer.curve },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: certificate.hash },
      key,
      signature,
      certificate.tbs,
    )
  } catch {
    return false
  }
}

/**
 * Checks the chain of a signing certificate as Apple's server library does: the intermediate is
 * issued by one of `roots` and may sign certificates, the leaf is issued by the intermediate,
 * both carry Apple's markers, and all three were valid at `at`.
 */
export async function verifyChain(
  leaf: Certificate,
  intermediate: Certificate,
  roots: readonly Certificate[],
  at: number,
): Promise<void> {
  let root: Certificate | undefined
  for (const candidate of roots) {
    if (await issuedBy(intermediate, candidate)) {
      root = candidate
      break
    }
  }
  if (!root) fail('the certificate chain does not lead to a trusted root')
  if (!(await issuedBy(leaf, intermediate)))
    fail('the signing certificate is not issued by its chain')
  if (!intermediate.ca) fail('the intermediate certificate may not sign certificates')
  if (!leaf.extensions.has(OID.appleReceiptSigning)) {
    fail('the signing certificate is not one the App Store signs with')
  }
  if (!intermediate.extensions.has(OID.appleDeveloperRelations)) {
    fail('the intermediate certificate is not one of Apple Worldwide Developer Relations')
  }
  for (const certificate of [leaf, intermediate, root]) {
    if (certificate.notBefore > at + MAX_SKEW || certificate.notAfter < at - MAX_SKEW) {
      fail('a certificate of the chain was not valid when the data was signed')
    }
  }
}

/** Decodes base64 and base64url. `null` for anything else */
export function fromBase64(text: string): Bytes | null {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (base64 === '' || !/^[A-Za-z0-9+/]+$/.test(base64) || base64.length % 4 === 1) return null
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function jsonObject(part: string, what: string): Record<string, unknown> {
  const bytes = fromBase64(part)
  let value: unknown
  try {
    value = bytes ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : null
  } catch {
    value = null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`the ${what} of the signed data is not a JSON object`)
  }
  return value as Record<string, unknown>
}

/**
 * Verifies a JWS of the App Store against `roots` and returns its payload. The chain is checked
 * at the time the payload says it was signed (`signedDate`), which the signature covers, so data
 * that was signed while its certificates were valid stays verifiable; without one, at `now`.
 * Throws `AppleSignatureError` for anything that is not signed by the App Store.
 */
export async function verifyAppleJws(
  jws: unknown,
  roots: readonly Certificate[],
  now: number,
): Promise<Record<string, unknown>> {
  if (typeof jws !== 'string' || jws === '') fail('the signed data is not a string')
  if (jws.length > MAX_JWS_LENGTH) fail('the signed data is too long')
  const parts = jws.split('.')
  if (parts.length !== 3) fail('the signed data is not a JWS')
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]

  const header = jsonObject(encodedHeader, 'header')
  // One algorithm, named here and never taken from the data: `none` and HMAC cannot get in.
  if (header.alg !== 'ES256') fail('the signed data is not signed with ES256')
  const chain = header.x5c
  if (
    !Array.isArray(chain) ||
    chain.length !== 3 ||
    !chain.every((entry) => typeof entry === 'string')
  ) {
    fail('the signed data carries no chain of three certificates')
  }
  const [leaf, intermediate] = (chain as string[]).slice(0, 2).map((entry) => {
    const der = fromBase64(entry)
    return der ? parseCertificate(der) : fail('a certificate is not base64')
  }) as [Certificate, Certificate]

  const payload = jsonObject(encodedPayload, 'payload')
  const signedDate = payload.signedDate
  const at = typeof signedDate === 'number' && Number.isFinite(signedDate) ? signedDate : now
  // The third certificate of the header is not trusted: the roots of the config are.
  await verifyChain(leaf, intermediate, roots, at)

  const signature = fromBase64(encodedSignature)
  if (leaf.curve !== 'P-256' || signature?.length !== 64) {
    fail('the signature is not one of ES256')
  }
  let valid = false
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      leaf.spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    )
  } catch {
    valid = false
  }
  if (!valid) fail('the signature does not match the signed data')
  return payload
}
