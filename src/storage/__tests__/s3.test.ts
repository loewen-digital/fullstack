/**
 * The S3 and R2 (S3 API) drivers against a `fetch` that plays the service: it verifies the
 * signature the way the service does, by signing the request it received again with the same
 * key pair and time, and answers what each test tells it to.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createS3Driver, createR2Driver, createStorageInstance } from '../index.js'
import { sha256Hex, signRequest } from '../sigv4.js'

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }

interface Received {
  method: string
  url: string
  headers: Headers
  body: Uint8Array
  verified: boolean
}

/** Replace fetch; every request is recorded, signature-checked and answered by `answer`. */
function service(region: string, answer: (request: Received) => Response = () => new Response(null, { status: 200 })) {
  const received: Received[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const amzDate = input.headers.get('x-amz-date')!
      const date = new Date(
        `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
      )
      const again = await signRequest(input, credentials, {
        region,
        date,
        payloadHash: input.headers.get('x-amz-content-sha256')!,
      })
      const request: Received = {
        method: input.method,
        url: input.url,
        headers: input.headers,
        body: new Uint8Array(await again.arrayBuffer()),
        verified: again.headers.get('authorization') === input.headers.get('authorization'),
      }
      received.push(request)
      return answer(request)
    }),
  )
  return received
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const s3 = () =>
  createStorageInstance(createS3Driver({ bucket: 'my-bucket', region: 'eu-central-1', ...credentials }))

describe('S3 driver', () => {
  it('GET: a signed request on the virtual-hosted URL, the key encoded once; 404 is null', async () => {
    const received = service('eu-central-1', ({ url }) =>
      url.endsWith('/missing.png') ? new Response('<Error/>', { status: 404 }) : new Response('hello'),
    )
    const storage = s3()

    expect(await storage.getText('avatars/a b.png')).toBe('hello')
    expect(await storage.get('missing.png')).toBeNull()

    expect(received[0]!.method).toBe('GET')
    expect(received[0]!.url).toBe('https://my-bucket.s3.eu-central-1.amazonaws.com/avatars/a%20b.png')
    expect(received[0]!.verified).toBe(true)
    expect(received[0]!.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/eu-central-1\/s3\/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/,
    )
  })

  it('GET: any other status is a StorageError with the status', async () => {
    service('eu-central-1', () => new Response('denied', { status: 403 }))
    await expect(s3().get('secret.txt')).rejects.toThrow('S3 GET failed for "secret.txt": 403')
  })

  it('PUT: bytes, string or stream go up hashed, with the content type signed', async () => {
    const received = service('eu-central-1')
    const storage = s3()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('str'))
        controller.enqueue(new TextEncoder().encode('eam'))
        controller.close()
      },
    })

    await storage.put('a.bin', new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' })
    await storage.put('b.txt', 'text')
    await storage.put('c.txt', stream)

    for (const request of received) {
      expect(request.method).toBe('PUT')
      expect(request.verified).toBe(true)
      expect(request.headers.get('x-amz-content-sha256')).toBe(await sha256Hex(new Uint8Array(request.body)))
    }
    expect(Array.from(received[0]!.body)).toEqual([1, 2, 3])
    expect(received[0]!.headers.get('content-type')).toBe('application/octet-stream')
    expect(received[0]!.headers.get('authorization')).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date')
    expect(new TextDecoder().decode(received[1]!.body)).toBe('text')
    expect(new TextDecoder().decode(received[2]!.body)).toBe('stream')
  })

  it('PUT: a failed upload throws', async () => {
    service('eu-central-1', () => new Response(null, { status: 500 }))
    await expect(s3().put('a.txt', 'x')).rejects.toThrow('S3 PUT failed for "a.txt": 500')
  })

  it('HEAD: exists is true on 200, false on 404 and an error otherwise', async () => {
    const received = service('eu-central-1', ({ url }) => {
      if (url.endsWith('/gone')) return new Response(null, { status: 404 })
      if (url.endsWith('/forbidden')) return new Response(null, { status: 403 })
      return new Response(null, { status: 200 })
    })
    const storage = s3()
    expect(await storage.exists('there')).toBe(true)
    expect(await storage.exists('gone')).toBe(false)
    await expect(storage.exists('forbidden')).rejects.toThrow('S3 HEAD failed for "forbidden": 403')
    expect(received.every((r) => r.method === 'HEAD' && r.verified)).toBe(true)
  })

  it('DELETE: 204 and 404 pass, anything else throws', async () => {
    const received = service('eu-central-1', ({ url }) => {
      if (url.endsWith('/gone')) return new Response(null, { status: 404 })
      if (url.endsWith('/locked')) return new Response(null, { status: 403 })
      return new Response(null, { status: 204 })
    })
    const storage = s3()
    await storage.delete('there')
    await storage.delete('gone')
    await expect(storage.delete('locked')).rejects.toThrow('S3 DELETE failed for "locked": 403')
    expect(received.every((r) => r.method === 'DELETE' && r.verified)).toBe(true)
  })

  it('LIST: a signed ListObjectsV2 on the bucket URL, keys unescaped', async () => {
    const received = service(
      'eu-central-1',
      () =>
        new Response(
          '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>my-bucket</Name><Prefix>docs/</Prefix>' +
            '<Contents><Key>docs/a.md</Key><Size>1</Size></Contents>' +
            '<Contents><Key>docs/b &amp; c &lt;d&gt;.md</Key></Contents></ListBucketResult>',
        ),
    )
    const keys = await s3().list('docs/')
    expect(keys).toEqual(['docs/a.md', 'docs/b & c <d>.md'])
    expect(received[0]!.url).toBe('https://my-bucket.s3.eu-central-1.amazonaws.com/?list-type=2&prefix=docs%2F')
    expect(received[0]!.verified).toBe(true)

    await s3().list()
    expect(received[1]!.url).toBe('https://my-bucket.s3.eu-central-1.amazonaws.com/?list-type=2')
  })

  it('LIST: a failed listing throws', async () => {
    service('eu-central-1', () => new Response(null, { status: 403 }))
    await expect(s3().list()).rejects.toThrow('S3 LIST failed: 403')
  })

  it('getUrl is the object URL on the endpoint', async () => {
    expect(await s3().getUrl('avatars/a b.png')).toBe('https://my-bucket.s3.eu-central-1.amazonaws.com/avatars/a%20b.png')
  })

  it('a custom endpoint with a port and path style, as MinIO wants it', async () => {
    const received = service('us-east-1')
    const storage = createStorageInstance(
      createS3Driver({
        bucket: 'uploads',
        region: 'us-east-1',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        ...credentials,
      }),
    )
    await storage.put('k.txt', 'v')
    await storage.list('k')
    expect(received[0]!.url).toBe('http://localhost:9000/uploads/k.txt')
    expect(received[1]!.url).toBe('http://localhost:9000/uploads?list-type=2&prefix=k')
    expect(received.every((r) => r.verified)).toBe(true)
    expect(await storage.getUrl('k.txt')).toBe('http://localhost:9000/uploads/k.txt')
  })
})

describe('R2 driver (S3 API)', () => {
  const r2 = (publicUrl?: string) =>
    createStorageInstance(createR2Driver({ accountId: 'acc0unt', bucket: 'files', publicUrl, ...credentials }))

  it('talks to the account endpoint in path style, signed for region auto', async () => {
    const received = service('auto', () => new Response('data'))
    const storage = r2()
    expect(await storage.getText('img/x y.png')).toBe('data')
    expect(received[0]!.url).toBe('https://acc0unt.r2.cloudflarestorage.com/files/img/x%20y.png')
    expect(received[0]!.verified).toBe(true)
    expect(received[0]!.headers.get('authorization')).toContain('/auto/s3/aws4_request')
  })

  it('errors carry the service name', async () => {
    service('auto', () => new Response(null, { status: 500 }))
    await expect(r2().get('x')).rejects.toThrow('R2 GET failed for "x": 500')
  })

  it('getUrl is publicUrl/key when set, the endpoint URL without', async () => {
    expect(await r2('https://files.example.com/').getUrl('img/x y.png')).toBe('https://files.example.com/img/x%20y.png')
    expect(await r2().getUrl('img/x y.png')).toBe('https://acc0unt.r2.cloudflarestorage.com/files/img/x%20y.png')
  })
})
