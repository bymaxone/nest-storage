/**
 * @fileoverview A missing bucket is its own failure, not an absent object: `NoSuchBucket` maps to
 * `STORAGE_BUCKET_NOT_FOUND` on every operation that carries an error body, `delete()` rejects it,
 * and `checkBucket()` probes the bucket with one `HeadBucket`. The S3 client is a `send` spy.
 * @layer server/services
 */
import { Logger } from '@nestjs/common'
import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'
import type { StorageException } from '../errors/storage-exception'

function makeService(opts: { configured?: boolean; bucket?: string } = {}): {
  service: StorageService
  send: jest.Mock
} {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  const effective = opts.bucket !== undefined ? { ...resolved, bucket: opts.bucket } : resolved
  const send = jest.fn()
  const s3Provider = {
    isConfigured: (): boolean => opts.configured ?? true,
    getClient: (): S3Client => ({ send }) as unknown as S3Client,
  } as unknown as S3ClientProvider
  const validation = {
    validate: jest
      .fn()
      .mockImplementation((input: { body: unknown }) => Promise.resolve({ body: input.body })),
  } as unknown as ValidationService
  const scanner = {
    isEnabled: jest.fn().mockReturnValue(false),
    getMode: jest.fn().mockReturnValue(null),
    scan: jest.fn(),
  } as unknown as FileScannerService
  const service = new StorageService(
    effective,
    s3Provider,
    new KeyResolverService(effective),
    new IdempotencyCache(100, 60_000, () => 0),
    validation,
    scanner,
  )
  return { service, send }
}

/** What the SDK throws for a request that names a bucket the provider does not have. */
function noSuchBucket(): Record<string, unknown> {
  return { name: 'NoSuchBucket', Code: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }
}

async function rejection(promise: Promise<unknown>): Promise<StorageException> {
  return (await promise.then(
    () => {
      throw new Error('expected a rejection')
    },
    (err: unknown) => err,
  )) as StorageException
}

describe('StorageService — missing bucket', () => {
  it.each([
    [
      'upload',
      (s: StorageService) =>
        s.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }),
    ],
    ['download', (s: StorageService) => s.download({ key: 'a' })],
    ['list', (s: StorageService) => s.list({})],
    ['copy', (s: StorageService) => s.copy({ sourceKey: 'a', destinationKey: 'b' })],
    ['delete', (s: StorageService) => s.delete('a')],
  ])('%s rejects STORAGE_BUCKET_NOT_FOUND', async (_name, call) => {
    // NoSuchBucket is not an absent object: the caller must be able to tell the two apart.
    const { service, send } = makeService()
    send.mockRejectedValue(noSuchBucket())

    const error = await rejection(call(service))

    expect(error.code).toBe('STORAGE_BUCKET_NOT_FOUND')
    expect(error.getStatus()).toBe(404)
  })

  it('delete() still treats a missing object as an idempotent no-op', async () => {
    const { service, send } = makeService()
    send.mockRejectedValue({
      name: 'NoSuchKey',
      Code: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    })
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(service.delete('a')).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('idempotent no-op'))
    warn.mockRestore()
  })

  it('head() cannot tell a missing bucket from a missing key, so it still reports an absent object', async () => {
    // A HEAD response has no body, so the SDK names every 404 "NotFound".
    const { service, send } = makeService()
    send.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })

    const error = await rejection(service.head('a'))

    expect(error.code).toBe('STORAGE_OBJECT_NOT_FOUND')
  })
})

describe('StorageService.checkBucket', () => {
  it('resolves when the bucket answers, sending one HeadBucket for the configured bucket', async () => {
    const { service, send } = makeService()
    send.mockResolvedValue({})

    await expect(service.checkBucket()).resolves.toBeUndefined()

    expect(send).toHaveBeenCalledTimes(1)
    const command = (send.mock.calls[0] as [HeadBucketCommand])[0]
    expect(command).toBeInstanceOf(HeadBucketCommand)
    expect(command.input).toEqual({ Bucket: 'test-bucket' })
  })

  it('checks the bucket given per call', async () => {
    const { service, send } = makeService()
    send.mockResolvedValue({})

    await service.checkBucket({ bucket: 'other' })

    expect((send.mock.calls[0] as [HeadBucketCommand])[0].input).toEqual({ Bucket: 'other' })
  })

  it.each([
    [
      'a 404',
      { name: 'NotFound', $metadata: { httpStatusCode: 404 } },
      'STORAGE_BUCKET_NOT_FOUND',
      404,
    ],
    ['NoSuchBucket', noSuchBucket(), 'STORAGE_BUCKET_NOT_FOUND', 404],
    [
      'a 403',
      { name: 'Forbidden', $metadata: { httpStatusCode: 403 } },
      'STORAGE_BUCKET_ACCESS_DENIED',
      403,
    ],
    [
      'a 301',
      { name: 'UnknownError', $metadata: { httpStatusCode: 301 } },
      'STORAGE_BUCKET_REGION_MISMATCH',
      500,
    ],
    ['PermanentRedirect', { name: 'PermanentRedirect' }, 'STORAGE_BUCKET_REGION_MISMATCH', 500],
    ['a timeout', { name: 'TimeoutError' }, 'STORAGE_TIMEOUT', 504],
    [
      'any other failure',
      { name: 'InternalError', $metadata: { httpStatusCode: 500 } },
      'STORAGE_PROVIDER_ERROR',
      502,
    ],
  ])('rejects %s with a typed code', async (_label, failure, code, status) => {
    const { service, send } = makeService()
    send.mockRejectedValue(failure)

    const error = await rejection(service.checkBucket())

    expect(error.code).toBe(code)
    expect(error.getStatus()).toBe(status)
  })

  it('carries the bucket in details and never the credentials', async () => {
    const { service, send } = makeService()
    send.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } })

    const error = await rejection(service.checkBucket())

    const details = (error.getResponse() as { error: { details: Record<string, unknown> } }).error
      .details
    expect(details).toMatchObject({ bucket: 'test-bucket', op: 'checkBucket' })
    expect(JSON.stringify(details)).not.toContain('secretAccessKey')
  })

  it('rejects STORAGE_NOT_CONFIGURED without credentials, before any request', async () => {
    const { service, send } = makeService({ configured: false })

    const error = await rejection(service.checkBucket())

    expect(error.code).toBe('STORAGE_NOT_CONFIGURED')
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects STORAGE_BUCKET_UNDEFINED when no bucket is configured or given', async () => {
    const { service, send } = makeService({ bucket: '' })

    const error = await rejection(service.checkBucket())

    expect(error.code).toBe('STORAGE_BUCKET_UNDEFINED')
    expect(send).not.toHaveBeenCalled()
  })
})
