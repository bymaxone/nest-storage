/**
 * @fileoverview Unit tests for `StorageService.deleteMany()`: the empty no-op,
 * `Quiet: false` batching, per-key success/failure aggregation, chunking at the
 * 1000-key S3 limit, whole-chunk failure handling, and prefix stripping. The S3
 * client is a `send` spy.
 * @layer server/services
 */
import type { DeleteObjectsCommandOutput, S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
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

/** Builds a `DeleteObjects` output. */
function deleteResponse(partial: Partial<DeleteObjectsCommandOutput> = {}): DeleteObjectsCommandOutput {
  return { $metadata: {}, ...partial }
}

describe('StorageService.deleteMany', () => {
  it('throws STORAGE_NOT_CONFIGURED when the client is missing', async () => {
    // assertConfigured guards the batch-delete path.
    const { service } = makeService({}, false)
    await expect(service.deleteMany(['a'])).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' })
  })

  it('short-circuits an empty input without calling S3', async () => {
    // No keys → no send, empty result.
    const { service, send } = makeService()
    const result = await service.deleteMany([])
    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({ deleted: [], failed: [] })
  })

  it('returns early on empty input BEFORE resolving the bucket', async () => {
    // The empty guard must `return` early: with an unresolvable (empty) bucket, a no-op
    // deleteMany([]) still succeeds — it never reaches resolveBucket (BUCKET_UNDEFINED).
    const { service } = makeService({ bucket: '' })
    await expect(service.deleteMany([])).resolves.toEqual({ deleted: [], failed: [] })
  })

  it('deletes with Quiet:false and reports successes', async () => {
    // Both successes and errors are requested via Quiet:false.
    const { service, send } = makeService()
    send.mockResolvedValue(deleteResponse({ Deleted: [{ Key: 'a.txt' }, { Key: 'b.txt' }] }))
    const result = await service.deleteMany(['a.txt', 'b.txt'])
    const input = firstInput(send) as { Delete: { Quiet: boolean; Objects: { Key: string }[] } }
    expect(input.Delete.Quiet).toBe(false)
    expect(input.Delete.Objects).toEqual([{ Key: 'a.txt' }, { Key: 'b.txt' }])
    expect(result.deleted).toEqual(['a.txt', 'b.txt'])
    expect(result.failed).toEqual([])
  })

  it('aggregates mixed successes and per-key failures', async () => {
    // Errors carry a readable "Code: Message"; missing fields default gracefully.
    const { service, send } = makeService()
    send.mockResolvedValue(
      deleteResponse({
        Deleted: [{ Key: 'ok.txt' }, {}],
        Errors: [{ Key: 'bad.txt', Code: 'AccessDenied', Message: 'nope' }, { Key: 'plain.txt' }, {}],
      }),
    )
    const result = await service.deleteMany(['ok.txt', 'bad.txt', 'plain.txt'])
    expect(result.deleted).toEqual(['ok.txt'])
    expect(result.failed).toEqual([
      { key: 'bad.txt', error: 'AccessDenied: nope' },
      { key: 'plain.txt', error: 'Unknown: ' },
    ])
  })

  it('chunks more than 1000 keys into separate requests', async () => {
    // 1001 keys → two DeleteObjects sends (1000 + 1).
    const { service, send } = makeService()
    send.mockResolvedValue(deleteResponse())
    const keys = Array.from({ length: 1001 }, (_, i) => `k${String(i)}.txt`)
    await service.deleteMany(keys)
    expect(send).toHaveBeenCalledTimes(2)
    const secondInput = (send.mock.calls[1] as [{ input: { Delete: { Objects: unknown[] } } }])[0].input
    expect(secondInput.Delete.Objects).toHaveLength(1)
  })

  it('sends exactly one request for a full 1000-key chunk', async () => {
    // The chunk boundary is inclusive of 1000 — no spurious empty second send.
    const { service, send } = makeService()
    send.mockResolvedValue(deleteResponse())
    const keys = Array.from({ length: 1000 }, (_, i) => `k${String(i)}.txt`)
    await service.deleteMany(keys)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('marks every key in a chunk as failed when the whole request throws', async () => {
    // A batch-level rejection fails all keys with the error message.
    const { service, send } = makeService()
    send.mockRejectedValue(new Error('network down'))
    const result = await service.deleteMany(['a.txt', 'b.txt'])
    expect(result.deleted).toEqual([])
    expect(result.failed).toEqual([
      { key: 'a.txt', error: 'network down' },
      { key: 'b.txt', error: 'network down' },
    ])
  })

  it('strips the global key prefix from returned keys', async () => {
    // Both deleted and failed keys come back without the tenant prefix.
    const { service, send } = makeService({ keyPrefix: 'tenant/' })
    send.mockResolvedValue(
      deleteResponse({
        Deleted: [{ Key: 'tenant/a.txt' }],
        Errors: [{ Key: 'tenant/b.txt', Code: 'X', Message: 'y' }],
      }),
    )
    const result = await service.deleteMany(['a.txt', 'b.txt'])
    expect(firstInput(send)).toMatchObject({
      Delete: { Objects: [{ Key: 'tenant/a.txt' }, { Key: 'tenant/b.txt' }] },
    })
    expect(result.deleted).toEqual(['a.txt'])
    expect(result.failed).toEqual([{ key: 'b.txt', error: 'X: y' }])
  })
})
