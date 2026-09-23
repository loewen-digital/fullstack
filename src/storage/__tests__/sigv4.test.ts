/**
 * The signer against the worked examples in "Signature Calculations for the Authorization Header:
 * Transferring Payload in a Single Chunk (AWS Signature Version 4)", Amazon S3 API Reference.
 * Same key pair, bucket and date in all of them.
 */
import { describe, it, expect } from 'vitest'
import { EMPTY_PAYLOAD_HASH, UNSIGNED_PAYLOAD, sha256Hex, signRequest, encodeKey, uriEncode } from '../sigv4.js'

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }
const region = 'us-east-1'
const date = new Date('2013-05-24T00:00:00Z')
const bucket = 'https://examplebucket.s3.amazonaws.com'

describe('signRequest against the AWS examples', () => {
  it('GET Object with a Range header', async () => {
    const request = new Request(`${bucket}/test.txt`, { headers: { Range: 'bytes=0-9' } })
    const signed = await signRequest(request, credentials, { region, date })

    expect(signed.headers.get('x-amz-date')).toBe('20130524T000000Z')
    expect(signed.headers.get('x-amz-content-sha256')).toBe(EMPTY_PAYLOAD_HASH)
    expect(signed.headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('PUT Object: the path encoded once, a Date header and the payload hash signed', async () => {
    const body = 'Welcome to Amazon S3.'
    const payloadHash = await sha256Hex(body)
    expect(payloadHash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072')

    const request = new Request(`${bucket}/test$file.text`, {
      method: 'PUT',
      headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      body,
    })
    // A string body makes fetch add a content-type, which the example does not sign.
    request.headers.delete('content-type')
    const signed = await signRequest(request, credentials, { region, date, payloadHash })

    expect(signed.headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,' +
        'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    )
    expect(await signed.text()).toBe(body)
  })

  it('GET Bucket Lifecycle: a query parameter without a value', async () => {
    const signed = await signRequest(new Request(`${bucket}/?lifecycle`), credentials, { region, date })
    expect(signed.headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date,' +
        'Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543',
    )
  })

  it('GET Bucket (List Objects): query parameters sorted', async () => {
    const signed = await signRequest(new Request(`${bucket}/?prefix=J&max-keys=2`), credentials, { region, date })
    expect(signed.headers.get('authorization')).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date,' +
        'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    )
  })
})

describe('signRequest', () => {
  async function signature(request: Request, options: Partial<Parameters<typeof signRequest>[2]> = {}): Promise<string> {
    const signed = await signRequest(request, credentials, { region, date, ...options })
    return signed.headers.get('authorization')!.split('Signature=')[1]!
  }

  it('signs a raw path and its encoded form alike, since S3 reads both as the same key', async () => {
    const raw = await signature(new Request(`${bucket}/a b/c!(d)*'.png`))
    const encoded = await signature(new Request(`${bucket}/${encodeKey("a b/c!(d)*'.png")}`))
    expect(encoded).toBe(raw)
    expect(encodeKey("a b/c!(d)*'.png")).toBe('a%20b/c%21%28d%29%2A%27.png')
    expect(uriEncode('a/b')).toBe('a%2Fb')
  })

  it('leaves the given request alone and returns a copy', async () => {
    const request = new Request(`${bucket}/x`)
    const signed = await signRequest(request, credentials, { region, date })
    expect(request.headers.has('authorization')).toBe(false)
    expect(signed).not.toBe(request)
    expect(signed.headers.has('authorization')).toBe(true)
  })

  it('a body without a hash is declared UNSIGNED-PAYLOAD, no body is the empty hash', async () => {
    const withBody = await signRequest(new Request(`${bucket}/x`, { method: 'PUT', body: new Uint8Array([1]) }), credentials, { region, date })
    expect(withBody.headers.get('x-amz-content-sha256')).toBe(UNSIGNED_PAYLOAD)
    const noBody = await signRequest(new Request(`${bucket}/x`, { method: 'DELETE' }), credentials, { region, date })
    expect(noBody.headers.get('x-amz-content-sha256')).toBe(EMPTY_PAYLOAD_HASH)
  })

  it('the host with its port, the region and the service are part of the signature', async () => {
    const local = await signature(new Request('http://localhost:9000/bucket/key'))
    expect(local).not.toBe(await signature(new Request('http://localhost:9001/bucket/key')))
    expect(local).not.toBe(await signature(new Request('http://localhost:9000/bucket/key'), { region: 'auto' }))
    expect(local).not.toBe(await signature(new Request('http://localhost:9000/bucket/key'), { service: 'sqs' }))
  })

  it('drops an Authorization header the caller set, so re-signing a signed request reproduces it', async () => {
    const first = await signRequest(new Request(`${bucket}/x`, { headers: { Authorization: 'stale' } }), credentials, { region, date })
    const again = await signRequest(first, credentials, { region, date })
    expect(again.headers.get('authorization')).toBe(first.headers.get('authorization'))
  })
})
