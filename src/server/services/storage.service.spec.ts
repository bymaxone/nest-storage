/**
 * @fileoverview Unit tests for the non-multipart `StorageService` paths:
 * validation, single-shot upload (headers, ACL, SSE, idempotency, progress),
 * head/exists, idempotent delete, and public URL building. The S3 client is a
 * hand-rolled `send` spy (no `aws-sdk-client-mock`).
 * @layer server/services
 */
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { UploadOptions } from '../interfaces/upload-options.interface'

const NOT_FOUND = { name: 'NotFound', $metadata: { httpStatusCode: 404 } }
const SERVER_ERROR = { name: 'InternalError', message: 'boom', $metadata: { httpStatusCode: 500 } }

interface Harness {
  service: StorageService
  send: jest.Mock
}

function makeService(
  overrides: Partial<BymaxStorageModuleOptions> = {},
  opts: { configured?: boolean; bucket?: string } = {},
): Harness {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    publicBaseUrl: 'https://cdn.example.com',
    ...overrides,
  })
  const effective = opts.bucket !== undefined ? { ...resolved, bucket: opts.bucket } : resolved
  const send = jest.fn()
  const client = { send } as unknown as S3Client
  const s3Provider = {
    isConfigured: (): boolean => opts.configured ?? true,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  const keyResolver = new KeyResolverService(effective)
  const cache = new IdempotencyCache(100, 60_000, () => 0)
  const service = new StorageService(effective, s3Provider, keyResolver, cache)
  return { service, send }
}

function uploadOf(overrides: Partial<UploadOptions> = {}): UploadOptions {
  return {
    key: 'a.txt',
    body: Buffer.from('hello'),
    contentType: 'text/plain',
    ...overrides,
  }
}

/** Returns the command input of the first `send` call. */
function firstInput(send: jest.Mock): Record<string, unknown> {
  const calls = send.mock.calls as [{ input: Record<string, unknown> }][]
  return calls[0]![0].input
}

describe('StorageService — validation', () => {
  it('throws STORAGE_NOT_CONFIGURED when the client is missing', async () => {
    // assertConfigured guards every operation.
    const { service } = makeService({}, { configured: false })
    await expect(service.upload(uploadOf())).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    })
  })

  it('throws STORAGE_BODY_MISSING when the body is undefined', async () => {
    // The undefined branch of the body guard.
    const { service } = makeService()
    await expect(
      service.upload({ key: 'a', body: undefined, contentType: 'text/plain' } as unknown as UploadOptions),
    ).rejects.toMatchObject({ code: 'STORAGE_BODY_MISSING' })
  })

  it('throws STORAGE_BODY_MISSING when the body is null', async () => {
    // The null branch of the body guard.
    const { service } = makeService()
    await expect(
      service.upload({ key: 'a', body: null, contentType: 'text/plain' } as unknown as UploadOptions),
    ).rejects.toMatchObject({ code: 'STORAGE_BODY_MISSING' })
  })

  it('throws STORAGE_CONTENT_TYPE_REQUIRED for an empty content type', async () => {
    // The content-type guard.
    const { service } = makeService()
    await expect(service.upload(uploadOf({ contentType: '' }))).rejects.toMatchObject({
      code: 'STORAGE_CONTENT_TYPE_REQUIRED',
    })
  })

  it('rejects an invalid key via the key resolver (path traversal guard)', async () => {
    // normalize() throws before any network call.
    const { service } = makeService()
    await expect(service.upload(uploadOf({ key: '../etc/passwd' }))).rejects.toMatchObject({
      code: 'STORAGE_KEY_INVALID',
    })
  })

  it('throws STORAGE_BUCKET_UNDEFINED when no bucket resolves', async () => {
    // resolveBucket throws when both per-call and module bucket are empty.
    const { service } = makeService({}, { bucket: '' })
    await expect(service.head('a.txt')).rejects.toMatchObject({
      code: 'STORAGE_BUCKET_UNDEFINED',
    })
  })
})

describe('StorageService — single-shot upload', () => {
  it('sends PutObject with the normalized key, content type, and metadata', async () => {
    // Core single-shot input assembly.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    await service.upload(uploadOf({ key: 'avatars/1.png', contentType: 'image/png', metadata: { originalName: 'me.png' } }))
    expect(firstInput(send)).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'avatars/1.png',
      ContentType: 'image/png',
      ContentLength: 5,
      Metadata: { originalName: 'me.png' },
    })
  })

  it('applies the global key prefix', async () => {
    // keyPrefix flows through the key resolver into the command.
    const { service, send } = makeService({ keyPrefix: 'tenant-x' })
    send.mockResolvedValue({ ETag: '"abc"' })
    await service.upload(uploadOf({ key: 'a.txt' }))
    expect(firstInput(send).Key).toBe('tenant-x/a.txt')
  })

  it('applies server-side encryption when configured', async () => {
    // Module SSE default appears on the command.
    const { service, send } = makeService({ serverSideEncryption: 'AES256' })
    send.mockResolvedValue({ ETag: '"abc"' })
    await service.upload(uploadOf())
    expect(firstInput(send).ServerSideEncryption).toBe('AES256')
  })

  it('applies the public-read ACL when requested', async () => {
    // Per-call publicRead maps to the ACL header.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    await service.upload(uploadOf({ publicRead: true }))
    expect(firstInput(send).ACL).toBe('public-read')
  })

  it('converts a Uint8Array body to a Buffer', async () => {
    // The Uint8Array branch of body normalization.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    await service.upload(uploadOf({ body: new Uint8Array([104, 105]) }))
    expect(Buffer.isBuffer(firstInput(send).Body)).toBe(true)
  })

  it('passes a known-size stream straight through on the single-shot path', async () => {
    // A small stream with a declared size stays single-shot; the body is the stream.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    const stream = Readable.from([Buffer.from('hi')])
    await service.upload(uploadOf({ body: stream, size: 2 }))
    expect(firstInput(send).Body).toBe(stream)
  })

  it('returns a populated UploadResult with multipart false', async () => {
    // Result fields including the built public URL and version id.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"', VersionId: 'v1' })
    const result = await service.upload(uploadOf({ key: 'a.txt' }))
    expect(result).toMatchObject({
      key: 'a.txt',
      bucket: 'test-bucket',
      etag: '"abc"',
      versionId: 'v1',
      size: 5,
      contentType: 'text/plain',
      publicUrl: 'https://cdn.example.com/test-bucket/a.txt',
      multipart: false,
      fromIdempotencyCache: false,
    })
  })

  it('defaults the etag to an empty string when absent', async () => {
    // The etag fallback branch.
    const { service, send } = makeService()
    send.mockResolvedValue({})
    const result = await service.upload(uploadOf())
    expect(result.etag).toBe('')
  })

  it('invokes onProgress once with the total', async () => {
    // Single-shot emits one terminal progress event.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    const onProgress = jest.fn()
    await service.upload(uploadOf({ onProgress }))
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith({ loaded: 5, total: 5 })
  })

  it('dedupes via the idempotency key within the TTL', async () => {
    // First call uploads and caches; second returns the cached result.
    const { service, send } = makeService()
    send.mockResolvedValue({ ETag: '"abc"' })
    const first = await service.upload(uploadOf({ idempotencyKey: 'req-1' }))
    const second = await service.upload(uploadOf({ idempotencyKey: 'req-1' }))
    expect(first.fromIdempotencyCache).toBe(false)
    expect(second.fromIdempotencyCache).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('maps a provider failure through mapAwsError', async () => {
    // A non-404 send rejection becomes a provider error.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    await expect(service.upload(uploadOf())).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_ERROR',
    })
  })
})

describe('StorageService — head / exists', () => {
  it('returns a fully populated ObjectMetadata', async () => {
    // All optional metadata fields present.
    const { service, send } = makeService()
    const lastModified = new Date('2026-01-01T00:00:00Z')
    send.mockResolvedValue({
      ContentLength: 10,
      ContentType: 'image/png',
      ETag: '"e"',
      LastModified: lastModified,
      CacheControl: 'no-store',
      ContentDisposition: 'inline',
      Metadata: { a: '1' },
      StorageClass: 'STANDARD',
      VersionId: 'v1',
    })
    await expect(service.head('a.png')).resolves.toEqual({
      key: 'a.png',
      bucket: 'test-bucket',
      size: 10,
      contentType: 'image/png',
      etag: '"e"',
      lastModified,
      cacheControl: 'no-store',
      contentDisposition: 'inline',
      metadata: { a: '1' },
      storageClass: 'STANDARD',
      versionId: 'v1',
    })
  })

  it('applies defaults when optional metadata fields are absent', async () => {
    // The absent-field branches of the metadata mapper.
    const { service, send } = makeService()
    send.mockResolvedValue({})
    const metadata = await service.head('a.png')
    expect(metadata).toEqual({
      key: 'a.png',
      bucket: 'test-bucket',
      size: 0,
      contentType: 'application/octet-stream',
      etag: '',
      lastModified: new Date(0),
      metadata: {},
    })
  })

  it('throws STORAGE_OBJECT_NOT_FOUND on a 404', async () => {
    // 404 maps to the not-found code.
    const { service, send } = makeService()
    send.mockRejectedValue(NOT_FOUND)
    await expect(service.head('missing')).rejects.toMatchObject({
      code: 'STORAGE_OBJECT_NOT_FOUND',
    })
  })

  it('exists returns true for a present object', async () => {
    // head succeeds → exists true.
    const { service, send } = makeService()
    send.mockResolvedValue({ ContentLength: 1 })
    await expect(service.exists('a.txt')).resolves.toBe(true)
  })

  it('exists returns false on a 404', async () => {
    // head 404 → exists false (the not-found branch).
    const { service, send } = makeService()
    send.mockRejectedValue(NOT_FOUND)
    await expect(service.exists('missing')).resolves.toBe(false)
  })

  it('exists returns false (with a warning) on a non-404 error', async () => {
    // A provider error is treated as "false" rather than thrown.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    await expect(service.exists('a.txt')).resolves.toBe(false)
  })

  it('exists returns false when head throws a non-StorageException', async () => {
    // The instanceof guard's false branch.
    const { service } = makeService()
    jest.spyOn(service, 'head').mockRejectedValue(new Error('unexpected'))
    await expect(service.exists('a.txt')).resolves.toBe(false)
  })
})

describe('StorageService — delete', () => {
  it('issues a DeleteObject command for an existing key', async () => {
    // The happy path normalizes the key and sends DeleteObject.
    const { service, send } = makeService({ keyPrefix: 'tenant-x' })
    send.mockResolvedValue({})
    await service.delete('a.txt')
    expect(firstInput(send)).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'tenant-x/a.txt',
    })
  })

  it('is idempotent on a 404 (no throw)', async () => {
    // A missing object is a logged no-op.
    const { service, send } = makeService()
    send.mockRejectedValue(NOT_FOUND)
    await expect(service.delete('missing')).resolves.toBeUndefined()
  })

  it('propagates a non-404 error', async () => {
    // Other failures surface as provider errors.
    const { service, send } = makeService()
    send.mockRejectedValue(SERVER_ERROR)
    await expect(service.delete('a.txt')).rejects.toMatchObject({
      code: 'STORAGE_PROVIDER_ERROR',
    })
  })
})

describe('StorageService — getPublicUrl', () => {
  it('uses the CDN base and avoids duplicating the bucket', () => {
    // cdnBaseUrl without the bucket → bucket is appended once.
    const { service } = makeService({ cdnBaseUrl: 'https://cdn.example.com' })
    expect(service.getPublicUrl('a.png')).toBe('https://cdn.example.com/test-bucket/a.png')
  })

  it('does not duplicate a bucket already present in the base', () => {
    // publicBaseUrl already containing the bucket → no duplication.
    const { service } = makeService({ publicBaseUrl: 'https://s3.example.com/test-bucket' })
    expect(service.getPublicUrl('a.png')).toBe('https://s3.example.com/test-bucket/a.png')
  })

  it('appends the bucket when its name is only an incidental substring of the base', () => {
    // bucket "test" must not match "latest" in the base — it is not a real path
    // segment there, so the bucket segment is still appended.
    const { service } = makeService({ cdnBaseUrl: 'https://cdn.example.com/latest' }, { bucket: 'test' })
    expect(service.getPublicUrl('a.png')).toBe('https://cdn.example.com/latest/test/a.png')
  })

  it('does not duplicate a bucket that is a genuine trailing path segment of the base', () => {
    // A base whose path ends in "/test" already carries the bucket segment.
    const { service } = makeService({ cdnBaseUrl: 'https://s3.example.com/test' }, { bucket: 'test' })
    expect(service.getPublicUrl('a.png')).toBe('https://s3.example.com/test/a.png')
  })

  it('does not duplicate a bucket carried as the virtual-hosted host label', () => {
    // Virtual-hosted-style base: the bucket is the leading host label, not a path
    // segment, so it must not be appended a second time.
    const { service } = makeService(
      { cdnBaseUrl: 'https://test-bucket.s3.example.com' },
      { bucket: 'test-bucket' },
    )
    expect(service.getPublicUrl('a.png')).toBe('https://test-bucket.s3.example.com/a.png')
  })
})
