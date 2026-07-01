/**
 * @fileoverview Unit tests for `StorageService.copy()`: the canonical
 * `CopySource` form, same-bucket and cross-bucket copies, the public-read ACL,
 * cache-control fallback, and AWS error mapping. The S3 client is a `send` spy.
 * @layer server/services
 */
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { StorageException } from '../errors/storage-exception'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

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

function makeService(overrides: Partial<BymaxStorageModuleOptions> = {}, configured = true): Harness {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    publicBaseUrl: 'https://cdn.example.com',
    ...overrides,
  })
  const send = jest.fn()
  const client = { send } as unknown as S3Client
  const s3Provider = {
    isConfigured: (): boolean => configured,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  const service = new StorageService(
    resolved,
    s3Provider,
    new KeyResolverService(resolved),
    new IdempotencyCache(100, 60_000, () => 0),
    makePassthroughValidation(),
    makeDisabledScanner(),
  )
  return { service, send }
}

function firstInput(send: jest.Mock): Record<string, unknown> {
  const calls = send.mock.calls as [{ input: Record<string, unknown> }][]
  return calls[0]![0].input
}

describe('StorageService.copy', () => {
  it('throws STORAGE_NOT_CONFIGURED when the client is missing', async () => {
    // assertConfigured guards the copy path.
    const { service } = makeService({}, false)
    await expect(service.copy({ sourceKey: 'a', destinationKey: 'b' })).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    })
  })

  it('copies within the default bucket using the /{bucket}/{key} CopySource', async () => {
    // Same-bucket copy: both keys resolve against the default bucket.
    const { service, send } = makeService()
    send.mockResolvedValue({ CopyObjectResult: { ETag: '"copied"' } })
    const result = await service.copy({ sourceKey: 'src.txt', destinationKey: 'dst.txt' })
    const input = firstInput(send)
    expect(input.Bucket).toBe('test-bucket')
    expect(input.Key).toBe('dst.txt')
    expect(input.CopySource).toBe('/test-bucket/src.txt')
    expect(input.CacheControl).toBe(DEFAULT_CACHE_CONTROL)
    expect(input.MetadataDirective).toBe('COPY')
    expect(input.ACL).toBeUndefined()
    expect(result.etag).toBe('"copied"')
  })

  it('percent-encodes each path segment of the source key in CopySource', async () => {
    // A source key with a space, a `+`, and a unicode char must be encoded per
    // segment; the segment-separating slashes stay literal (no double-encoding).
    const { service, send } = makeService()
    send.mockResolvedValue({ CopyObjectResult: { ETag: '"z"' } })
    await service.copy({ sourceKey: 'a b/c+d/€.txt', destinationKey: 'dst.txt' })
    const input = firstInput(send)
    expect(input.CopySource).toBe('/test-bucket/a%20b/c%2Bd/%E2%82%AC.txt')
  })

  it('supports cross-bucket copies when both buckets are provided', async () => {
    // The CopySource references the source bucket, the target references the dest.
    const { service, send } = makeService()
    send.mockResolvedValue({ CopyObjectResult: { ETag: '"x"' } })
    await service.copy({
      sourceKey: 'src.txt',
      destinationKey: 'dst.txt',
      sourceBucket: 'from-bucket',
      destinationBucket: 'to-bucket',
    })
    const input = firstInput(send)
    expect(input.Bucket).toBe('to-bucket')
    expect(input.CopySource).toBe('/from-bucket/src.txt')
  })

  it('applies the public-read ACL and a cache-control override', async () => {
    // publicRead → ACL; an explicit cacheControl overrides the default.
    const { service, send } = makeService()
    send.mockResolvedValue({ CopyObjectResult: { ETag: '"y"' } })
    await service.copy({ sourceKey: 'a', destinationKey: 'b', publicRead: true, cacheControl: 'no-store' })
    const input = firstInput(send)
    expect(input.ACL).toBe('public-read')
    expect(input.CacheControl).toBe('no-store')
  })

  it('returns an empty etag when CopyObjectResult is absent', async () => {
    // A provider omitting CopyObjectResult yields an empty ETag rather than throwing.
    const { service, send } = makeService()
    send.mockResolvedValue({})
    const result = await service.copy({ sourceKey: 'a', destinationKey: 'b' })
    expect(result.etag).toBe('')
  })

  it('maps AWS failures through mapAwsError with the copy op context', async () => {
    // A provider error surfaces as STORAGE_PROVIDER_ERROR carrying source/dest key + op.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    const err = await service.copy({ sourceKey: 'a', destinationKey: 'b' }).catch((e: unknown) => e)
    expect((err as StorageException).code).toBe('STORAGE_PROVIDER_ERROR')
    const details = ((err as StorageException).getResponse() as {
      error: { details: Record<string, unknown> }
    }).error.details
    expect(details.op).toBe('copy')
    expect(details.sourceKey).toBe('a')
    expect(details.destKey).toBe('b')
  })
})
