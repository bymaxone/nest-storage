/**
 * @fileoverview Unit tests for `StorageService.list()`: prefix normalization,
 * the `maxKeys` clamp at the S3 hard cap, continuation-token paging, delimiter →
 * `commonPrefixes`, prefix stripping, and AWS error mapping. The S3 client is a
 * `send` spy (no `aws-sdk-client-mock`).
 * @layer server/services
 */
import type { ListObjectsV2CommandOutput, S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

/** Stub ValidationService that passes everything through unchanged. */
function makePassthroughValidation(): ValidationService {
  return {
    validate: jest.fn().mockImplementation((input: { body: unknown }) => Promise.resolve({ body: input.body })),
  } as unknown as ValidationService
}

/** Stub FileScannerService with scanning disabled. */
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

/** Returns the command input of the first `send` call. */
function firstInput(send: jest.Mock): Record<string, unknown> {
  const calls = send.mock.calls as [{ input: Record<string, unknown> }][]
  return calls[0]![0].input
}

/** Builds a `ListObjectsV2` output, defaulting to an empty page. */
function listResponse(partial: Partial<ListObjectsV2CommandOutput> = {}): ListObjectsV2CommandOutput {
  return { $metadata: {}, ...partial }
}

describe('StorageService.list', () => {
  it('throws STORAGE_NOT_CONFIGURED when the client is missing', async () => {
    // assertConfigured guards the listing path.
    const { service } = makeService({}, false)
    await expect(service.list({})).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
  })

  it('clamps maxKeys above the S3 cap to 1000 and threads the continuation token', async () => {
    // maxKeys 5000 → 1000; the inbound token is forwarded verbatim.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse())
    await service.list({ maxKeys: 5000, continuationToken: 'tok-1' })
    expect(firstInput(send).MaxKeys).toBe(1000)
    expect(firstInput(send).ContinuationToken).toBe('tok-1')
  })

  it('defaults maxKeys to the S3 cap when unset', async () => {
    // Absent maxKeys falls back to 1000.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse())
    await service.list({})
    expect(firstInput(send).MaxKeys).toBe(1000)
  })

  it('honors a maxKeys below the cap', async () => {
    // A small page size passes through unchanged.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse())
    await service.list({ maxKeys: 50 })
    expect(firstInput(send).MaxKeys).toBe(50)
  })

  it('normalizes the caller prefix and strips the global prefix from returned keys', async () => {
    // keyPrefix isolation: the request prefix is fully-qualified, the response is not.
    const { service, send } = makeService({ keyPrefix: 'tenant/' })
    send.mockResolvedValue(
      listResponse({
        Contents: [
          { Key: 'tenant/avatars/a.png', Size: 10, ETag: '"e"', LastModified: new Date(1), StorageClass: 'STANDARD' },
        ],
      }),
    )
    const result = await service.list({ prefix: 'avatars/' })
    expect(firstInput(send).Prefix).toBe('tenant/avatars/')
    expect(result.objects).toEqual([
      { key: 'avatars/a.png', size: 10, etag: '"e"', lastModified: new Date(1), storageClass: 'STANDARD' },
    ])
  })

  it('uses the global key prefix when no per-call prefix is given', async () => {
    // Absent prefix defaults to the configured global prefix.
    const { service, send } = makeService({ keyPrefix: 'tenant/' })
    send.mockResolvedValue(listResponse())
    await service.list({})
    expect(firstInput(send).Prefix).toBe('tenant/')
  })

  it('aggregates commonPrefixes for a delimiter and drops empty entries', async () => {
    // Empty/absent CommonPrefix entries are filtered before stripping.
    const { service, send } = makeService()
    send.mockResolvedValue(
      listResponse({ CommonPrefixes: [{ Prefix: 'avatars/2024/' }, { Prefix: '' }, {}] }),
    )
    const result = await service.list({ delimiter: '/' })
    expect(firstInput(send).Delimiter).toBe('/')
    expect(result.commonPrefixes).toEqual(['avatars/2024/'])
  })

  it('surfaces isTruncated and nextContinuationToken', async () => {
    // Truncated pages carry the next token forward.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse({ IsTruncated: true, NextContinuationToken: 'tok-2' }))
    const result = await service.list({})
    expect(result.isTruncated).toBe(true)
    expect(result.nextContinuationToken).toBe('tok-2')
  })

  it('omits nextContinuationToken and defaults isTruncated on the last page', async () => {
    // A final page has neither a token nor a truncation flag.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse())
    const result = await service.list({})
    expect(result.isTruncated).toBe(false)
    expect(result.nextContinuationToken).toBeUndefined()
  })

  it('applies safe defaults for missing object fields', async () => {
    // A bare Contents entry yields fully-defaulted fields and no storageClass.
    const { service, send } = makeService()
    send.mockResolvedValue(listResponse({ Contents: [{}] }))
    const result = await service.list({})
    expect(result.objects).toEqual([
      { key: '', size: 0, etag: '', lastModified: new Date(0) },
    ])
  })

  it('maps AWS failures through mapAwsError', async () => {
    // A provider error surfaces as STORAGE_PROVIDER_ERROR.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    await expect(service.list({ prefix: 'x/' })).rejects.toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
  })
})
