/**
 * A certificate chain made for a test run, built like the one the App Store signs with: a root
 * and an intermediate on P-384, a leaf on P-256, and Apple's two marker extensions. The keys are
 * generated per run and never leave the process: no key of anyone is near the tests.
 */

type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()

function concat(parts: Uint8Array[]): Bytes {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

/** One DER element: tag, length, content */
function der(tag: number, ...content: Uint8Array[]): Bytes {
  const body = concat(content)
  const length: number[] = []
  if (body.length < 0x80) length.push(body.length)
  else {
    for (let rest = body.length; rest > 0; rest >>= 8) length.unshift(rest & 0xff)
    length.unshift(0x80 | length.length)
  }
  return concat([Uint8Array.of(tag, ...length), body])
}

const sequence = (...content: Uint8Array[]): Bytes => der(0x30, ...content)
const octets = (content: Uint8Array): Bytes => der(0x04, content)
const bits = (content: Uint8Array): Bytes => der(0x03, Uint8Array.of(0), content)
const boolean = (value: boolean): Bytes => der(0x01, Uint8Array.of(value ? 0xff : 0))

function integer(value: Uint8Array): Bytes {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const digits = value.subarray(start)
  return der(0x02, digits[0]! & 0x80 ? concat([Uint8Array.of(0), digits]) : digits)
}

function oid(dotted: string): Bytes {
  const arcs = dotted.split('.').map(Number)
  const bytes = [arcs[0]! * 40 + arcs[1]!]
  for (const arc of arcs.slice(2)) {
    const chunk = [arc & 0x7f]
    for (let rest = Math.floor(arc / 128); rest > 0; rest = Math.floor(rest / 128)) {
      chunk.unshift((rest & 0x7f) | 0x80)
    }
    bytes.push(...chunk)
  }
  return der(0x06, Uint8Array.from(bytes))
}

function utcTime(date: Date): Bytes {
  const text = date
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  return der(0x17, encoder.encode(text.slice(2)))
}

const name = (commonName: string): Bytes =>
  sequence(der(0x31, sequence(oid('2.5.4.3'), der(0x0c, encoder.encode(commonName)))))

const CURVES = {
  'P-256': { hash: 'SHA-256', algorithm: '1.2.840.10045.4.3.2', size: 32 },
  'P-384': { hash: 'SHA-384', algorithm: '1.2.840.10045.4.3.3', size: 48 },
} as const
type Curve = keyof typeof CURVES

export const APPLE_LEAF_MARKER = '1.2.840.113635.100.6.11.1'
export const APPLE_INTERMEDIATE_MARKER = '1.2.840.113635.100.6.2.1'

interface Identity {
  name: string
  curve: Curve
  keys: CryptoKeyPair
}

async function identity(commonName: string, curve: Curve): Promise<Identity> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ])
  return { name: commonName, curve, keys }
}

interface CertificateInput {
  subject: Identity
  issuer: Identity
  ca: boolean
  /** Extension ids to carry, each with an empty value, as Apple's markers are */
  markers?: string[]
  notBefore?: Date
  notAfter?: Date
}

async function certificate(input: CertificateInput): Promise<Bytes> {
  const signer = CURVES[input.issuer.curve]
  const algorithm = sequence(oid(signer.algorithm))
  const extensions = [
    sequence(
      oid('2.5.29.19'),
      boolean(true),
      octets(sequence(...(input.ca ? [boolean(true)] : []))),
    ),
    ...(input.markers ?? []).map((marker) => sequence(oid(marker), octets(der(0x05)))),
  ]
  const tbs = sequence(
    der(0xa0, integer(Uint8Array.of(2))),
    integer(crypto.getRandomValues(new Uint8Array(8))),
    algorithm,
    name(input.issuer.name),
    sequence(
      utcTime(input.notBefore ?? new Date('2020-01-01T00:00:00Z')),
      utcTime(input.notAfter ?? new Date('2040-01-01T00:00:00Z')),
    ),
    name(input.subject.name),
    new Uint8Array(await crypto.subtle.exportKey('spki', input.subject.keys.publicKey)),
    der(0xa3, sequence(...extensions)),
  )
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: signer.hash },
      input.issuer.keys.privateKey,
      tbs,
    ),
  )
  const signature = sequence(
    integer(raw.subarray(0, signer.size)),
    integer(raw.subarray(signer.size)),
  )
  return sequence(tbs, algorithm, bits(signature))
}

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const base64Url = (bytes: Uint8Array): string =>
  base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface TestChainOptions {
  /** Leave Apple's marker off the leaf */
  leafMarker?: boolean
  /** Leave Apple's marker off the intermediate */
  intermediateMarker?: boolean
  /** An intermediate that may not sign certificates */
  intermediateCa?: boolean
  /** The leaf names another issuer than the intermediate, whose key signed it all the same */
  leafIssuerName?: string
  /** The curve of the signing key (default: P-256, what ES256 takes) */
  leafCurve?: Curve
  leafNotBefore?: Date
  leafNotAfter?: Date
}

export interface TestChain {
  /** The root in DER: what a driver under test is told to trust */
  root: Bytes
  /** The certificates as a JWS header carries them: leaf, intermediate, root, in base64 */
  x5c: [string, string, string]
  /** A JWS over `payload`, signed by the leaf, as the App Store builds it */
  sign(payload: unknown, header?: Record<string, unknown>): Promise<string>
}

export async function createTestChain(options: TestChainOptions = {}): Promise<TestChain> {
  const root = await identity('Test Root', 'P-384')
  const intermediate = await identity('Test Intermediate', 'P-384')
  const leaf = await identity('Test Signing', options.leafCurve ?? 'P-256')

  const rootCertificate = await certificate({ subject: root, issuer: root, ca: true })
  const intermediateCertificate = await certificate({
    subject: intermediate,
    issuer: root,
    ca: options.intermediateCa ?? true,
    markers: options.intermediateMarker === false ? [] : [APPLE_INTERMEDIATE_MARKER],
  })
  const leafCertificate = await certificate({
    subject: leaf,
    issuer: { ...intermediate, name: options.leafIssuerName ?? intermediate.name },
    ca: false,
    markers: options.leafMarker === false ? [] : [APPLE_LEAF_MARKER],
    notBefore: options.leafNotBefore,
    notAfter: options.leafNotAfter,
  })
  const x5c: [string, string, string] = [
    base64(leafCertificate),
    base64(intermediateCertificate),
    base64(rootCertificate),
  ]

  return {
    root: rootCertificate,
    x5c,
    async sign(payload, header = {}) {
      const signed = `${base64Url(encoder.encode(JSON.stringify({ alg: 'ES256', x5c, ...header })))}.${base64Url(encoder.encode(JSON.stringify(payload)))}`
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: CURVES[leaf.curve].hash },
        leaf.keys.privateKey,
        encoder.encode(signed),
      )
      return `${signed}.${base64Url(new Uint8Array(signature))}`
    },
  }
}
