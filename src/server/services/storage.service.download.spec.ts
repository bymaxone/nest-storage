/**
 * @fileoverview Unit tests for the download paths: the streaming `download()` and
 * the buffer-materializing `downloadBuffer()`. The S3 client is a `send` spy that
 * returns mock GetObject responses.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

function makePassthroughValidation(): ValidationService {
  return {
    validate: jest.fn().mockImplementation((input: { body: unknown }) => Promise.resolve({ body: input.body })),
  } as unknown as ValidationService
}

function makeDisabledScanner(): FileScannerService {
  return {
    isEnabled: jest.fn().mockReturnValue(false),
    getMode: jest.fn().mockReturnValue(null),
    scan: jest.fn(),
  } as unknown as FileScannerService
}

const SERVER_ERROR = { name: 'InternalError', message: 'boom', $metadata: { httpStatusCode: 500 } }

interface Harness {
  service: StorageService
  send: jest.Mock
}

function makeService(): Harness {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    publicBaseUrl: 'https://cdn.example.com',
  })
  const send = jest.fn()
  const client = { send } as unknown as S3Client
  const s3Provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  const keyResolver = new KeyResolverService(resolved)
  const cache = new IdempotencyCache(100, 60_000, () => 0)
  const service = new StorageService(
    resolved,
    s3Provider,
    keyResolver,
    cache,
    makePassthroughValidation(),
    makeDisabledScanner(),
  )
  return { service, send }
}

/** Returns the command input of the first `send` call. */
function firstInput(send: jest.Mock): Record<string, unknown> {
  const calls = send.mock.calls as [{ input: Record<string, unknown> }][]
  return calls[0]![0].input
}

/** Drains a stream to a string. */
async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString()
}

describe('StorageService — download', () => {
  it('returns a consumable stream and the object metadata', async () => {
    // The GetObject body is returned as a Node Readable alongside metadata.
    const { service, send } = makeService()
    const lastModified = new Date('2026-01-01T00:00:00Z')
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('hello')]),
      ContentLength: 5,
      ContentType: 'text/plain',
      ETag: '"e"',
      LastModified: lastModified,
    })
    const { stream, metadata } = await service.download({ key: 'a.txt' })
    expect(await collect(stream)).toBe('hello')
    expect(metadata).toMatchObject({
      key: 'a.txt',
      bucket: 'test-bucket',
      size: 5,
      contentType: 'text/plain',
      etag: '"e"',
      lastModified,
    })
  })

  it('forwards Range, IfNoneMatch, and IfMatch to GetObject', async () => {
    // Conditional/partial GET headers are propagated.
    const { service, send } = makeService()
    send.mockResolvedValue({ Body: Readable.from([Buffer.from('x')]) })
    await service.download({ key: 'a.txt', range: 'bytes=0-1', ifNoneMatch: '"a"', ifMatch: '"b"' })
    expect(firstInput(send)).toMatchObject({
      Range: 'bytes=0-1',
      IfNoneMatch: '"a"',
      IfMatch: '"b"',
    })
  })

  it('throws STORAGE_OBJECT_NOT_FOUND when the response has no body', async () => {
    // An empty body is treated as a missing object.
    const { service, send } = makeService()
    send.mockResolvedValue({})
    await expect(service.download({ key: 'missing' })).rejects.toMatchObject({
      code: 'STORAGE_OBJECT_NOT_FOUND',
    })
  })

  it('maps a provider failure through mapAwsError', async () => {
    // A send rejection is mapped to a typed provider error.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    await expect(service.download({ key: 'a.txt' })).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_ERROR',
    })
  })

  it('materializes the object into a Buffer via downloadBuffer', async () => {
    // downloadBuffer consumes the sdk-stream-mixin transformToByteArray.
    const { service, send } = makeService()
    send.mockResolvedValue({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([104, 105])) },
      ContentLength: 2,
      ContentType: 'application/octet-stream',
    })
    const { buffer, metadata } = await service.downloadBuffer({ key: 'a.bin' })
    expect(buffer.toString()).toBe('hi')
    expect(metadata.size).toBe(2)
  })
})
