/**
 * @fileoverview Rows for a key planted on the root object prototype: the provider refuses to
 * build the client, and the client refuses every attempt of every command, before any request
 * is handed to the HTTP handler.
 * @layer server/providers
 */
import { Readable } from 'node:stream'
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { StorageException } from '../errors/storage-exception'
import { applyDefaults } from '../config/apply-defaults'
import { S3ClientProvider } from './s3-client.provider'

interface Captured {
  headers: Record<string, string>
  hostname: string
}

function makeProvider(maxAttempts = 1): S3ClientProvider {
  return new S3ClientProvider(
    applyDefaults({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      maxAttempts,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  )
}

function mockHandler(statuses: number[]): {
  calls: Captured[]
  install: (client: S3Client) => void
} {
  const calls: Captured[] = []
  const handler = {
    handle: (request: Captured) => {
      calls.push(request)
      const statusCode = statuses[calls.length - 1] ?? 200
      return Promise.resolve({ response: { statusCode, headers: {}, body: Readable.from([]) } })
    },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
  }
  return {
    calls,
    install: (client) => {
      client.config.requestHandler = handler as never
    },
  }
}

function plant(name: string, value: unknown): () => void {
  Object.defineProperty(Object.prototype, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
  return () => {
    Reflect.deleteProperty(Object.prototype, name)
  }
}

const put = (): PutObjectCommand =>
  new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: Buffer.from('x') })

describe('S3ClientProvider with a key planted on the root object prototype', () => {
  it('sends the request unchanged while the root is clean', async () => {
    // Control row: the mock handler sees the request, with no ACL header and the configured host.
    const provider = makeProvider()
    provider.onModuleInit()
    const { calls, install } = mockHandler([])
    install(provider.getClient())
    await provider.getClient().send(put())
    expect(calls).toHaveLength(1)
    expect(calls[0]?.headers['x-amz-acl']).toBeUndefined()
    expect(calls[0]?.hostname).toBe('s3.example.com')
  })

  it('names the guard in the middleware stack, after the retry middleware', () => {
    // The name is what a host reads in `identify()` and what an operator removes it by.
    const provider = makeProvider()
    provider.onModuleInit()
    const stack = provider.getClient().middlewareStack.identify()
    const guard = stack.findIndex((line) => line.startsWith('rootPrototypeGuard'))
    const retry = stack.findIndex((line) => line.startsWith('retryMiddleware'))
    expect(guard).toBeGreaterThan(-1)
    expect(retry).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(retry)
  })

  it.each([
    ['ACL', 'public-read'],
    ['GrantRead', 'uri=evil'],
    ['ServerSideEncryption', 'aws:kms'],
    ['StorageClass', 'GLACIER'],
    ['WebsiteRedirectLocation', 'https://evil.example'],
    ['Tagging', 'a=b'],
    ['Metadata', { x: 'y' }],
  ])(
    'refuses a command while %s is planted and hands nothing to the handler',
    async (name, value) => {
      const provider = makeProvider()
      provider.onModuleInit()
      const { calls, install } = mockHandler([])
      install(provider.getClient())
      const restore = plant(name, value)
      try {
        await expect(provider.getClient().send(put())).rejects.toMatchObject({
          code: 'STORAGE_VALIDATION_FAILED',
        })
      } finally {
        restore()
      }
      expect(calls).toHaveLength(0)
    },
  )

  it.each(['endpointProvider', 'endpoint', 'protocol', 'useFipsEndpoint', 'bucketEndpoint', 'url'])(
    'refuses to build the client while %s is planted',
    (name) => {
      const restore = plant(name, name === 'endpoint' ? 'https://evil.example' : true)
      try {
        const provider = makeProvider()
        expect(() => {
          provider.onModuleInit()
        }).toThrow(StorageException)
        expect(provider.isConfigured()).toBe(false)
      } finally {
        restore()
      }
    },
  )

  it('refuses the retry of a command when the key is planted after the first attempt', async () => {
    // The first attempt is answered 503 and retried; the plant lands in between, so the
    // second attempt must never reach the handler.
    const provider = makeProvider(3)
    provider.onModuleInit()
    const { calls, install } = mockHandler([503])
    const client = provider.getClient()
    install(client)
    let restore: (() => void) | undefined
    const inner = client.config.requestHandler as { handle: (r: Captured) => Promise<unknown> }
    const first = inner.handle.bind(inner)
    inner.handle = (request) => {
      const result = first(request)
      restore = plant('ACL', 'public-read')
      return result
    }
    try {
      await expect(client.send(put())).rejects.toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    } finally {
      restore?.()
    }
    expect(calls).toHaveLength(1)
  })

  it('refuses to presign a URL while a key is planted, and presigns while the root is clean', async () => {
    // The presigner serialises the command into the query string: a planted name would be signed in.
    const provider = makeProvider()
    provider.onModuleInit()
    const get = (): GetObjectCommand => new GetObjectCommand({ Bucket: 'b', Key: 'k' })
    await expect(getSignedUrl(provider.getClient(), get(), { expiresIn: 60 })).resolves.toContain(
      'X-Amz-Signature',
    )
    const restore = plant('ResponseContentType', 'text/html')
    try {
      await expect(
        getSignedUrl(provider.getClient(), get(), { expiresIn: 60 }),
      ).rejects.toMatchObject({
        code: 'STORAGE_VALIDATION_FAILED',
      })
    } finally {
      restore()
    }
  })

  it('refuses the managed upload while a key is planted and hands nothing to the handler', async () => {
    const provider = makeProvider()
    provider.onModuleInit()
    const { calls, install } = mockHandler([])
    install(provider.getClient())
    const restore = plant('ACL', 'public-read')
    try {
      const upload = new Upload({
        client: provider.getClient(),
        params: { Bucket: 'b', Key: 'k', Body: Buffer.from('x') },
      })
      await expect(upload.done()).rejects.toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    } finally {
      restore()
    }
    expect(calls).toHaveLength(0)
  })

  it('reads the credentials from a null-prototype object with an own session token field', async () => {
    // A sessionToken planted after the client exists must not become x-amz-security-token.
    const provider = makeProvider()
    provider.onModuleInit()
    const restore = plant('sessionToken', 'EVIL')
    try {
      const credentials = await provider.getClient().config.credentials()
      expect(credentials.sessionToken).toBeUndefined()
      expect(credentials.accessKeyId).toBe('AK')
    } finally {
      restore()
    }
  })
})
