/**
 * @fileoverview Unit tests for the multipart upload path. The `Upload` class from
 * `@aws-sdk/lib-storage` is mocked so the threshold decision, progress events, and
 * the abort-to-error mapping can be exercised without real network I/O.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { StorageService } from './storage.service'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { UploadOptions } from '../interfaces/upload-options.interface'
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

jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }))

const UploadMock = Upload as unknown as jest.Mock

type ProgressListener = (payload: { loaded?: number; total?: number; part?: number }) => void

interface FakeUploader {
  listeners: Record<string, ProgressListener>
  on: jest.Mock
  done: jest.Mock
}

/** Installs a fake `Upload` instance whose `done()` runs the given behavior. */
function installUploader(done: (uploader: FakeUploader) => Promise<unknown>): FakeUploader {
  const listeners: Record<string, ProgressListener> = {}
  const uploader: FakeUploader = {
    listeners,
    on: jest.fn((event: string, listener: ProgressListener) => {
      listeners[event] = listener
      return uploader
    }),
    done: jest.fn(() => done(uploader)),
  }
  UploadMock.mockImplementation(() => uploader)
  return uploader
}

interface Harness {
  service: StorageService
  resolved: ResolvedBymaxStorageOptions
}

function makeService(overrides: Partial<BymaxStorageModuleOptions> = {}): Harness {
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
    publicBaseUrl: 'https://cdn.example.com',
    ...overrides,
  })
  const client = { send: jest.fn() } as unknown as S3Client
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
  return { service, resolved }
}

function uploadOf(overrides: Partial<UploadOptions> = {}): UploadOptions {
  return { key: 'a.txt', body: Readable.from([Buffer.from('data')]), contentType: 'text/plain', ...overrides }
}

/** Returns the constructor options of the first `Upload` instantiation. */
function uploaderOptions(): Record<string, unknown> {
  const calls = UploadMock.mock.calls as [Record<string, unknown>][]
  return calls[0]![0]
}

beforeEach(() => {
  UploadMock.mockReset()
})

describe('StorageService — multipart upload', () => {
  it('uses multipart for a stream of unknown size and reports multipart true', async () => {
    // A stream without a declared size forces the multipart path.
    const { service, resolved } = makeService()
    installUploader(() => Promise.resolve({ ETag: '"m"', VersionId: 'v1' }))
    const result = await service.upload(uploadOf())
    expect(result.multipart).toBe(true)
    expect(result.versionId).toBe('v1')
    expect(result.size).toBeUndefined()
    expect(uploaderOptions().leavePartsOnError).toBe(false)
    expect(uploaderOptions().queueSize).toBe(resolved.multipart.queueSize)
    expect(uploaderOptions().partSize).toBe(resolved.multipart.partSizeBytes)
    expect(uploaderOptions().params).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'a.txt',
      ContentType: 'text/plain',
    })
  })

  it('uses multipart for a body at or above the threshold', async () => {
    // A buffer at the (lowered) threshold takes the multipart path.
    const { service } = makeService({ multipart: { thresholdBytes: 4 } })
    installUploader(() => Promise.resolve({ ETag: '"m"' }))
    const result = await service.upload(uploadOf({ body: Buffer.from('abcd'), size: 4 }))
    expect(result.multipart).toBe(true)
    expect(result.size).toBe(4)
  })

  it('forwards httpUploadProgress events to onProgress', async () => {
    // The progress event carries loaded/total/part through to the callback.
    const { service } = makeService()
    installUploader((uploader) => {
      uploader.listeners.httpUploadProgress?.({ loaded: 50, total: 100, part: 1 })
      return Promise.resolve({ ETag: '"m"' })
    })
    const onProgress = jest.fn()
    await service.upload(uploadOf({ onProgress }))
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, total: 100, part: 1 })
  })

  it('defaults loaded to 0 and omits total when the progress event lacks them', async () => {
    // A sparse progress event still produces a well-formed callback payload.
    const { service } = makeService()
    installUploader((uploader) => {
      uploader.listeners.httpUploadProgress?.({ part: 2 })
      return Promise.resolve({ ETag: '"m"' })
    })
    const onProgress = jest.fn()
    await service.upload(uploadOf({ onProgress }))
    expect(onProgress).toHaveBeenCalledWith({ loaded: 0, part: 2 })
  })

  it('maps a failed done() to STORAGE_MULTIPART_ABORTED with details', async () => {
    // A multipart failure surfaces the abort code and non-sensitive details.
    const { service } = makeService()
    installUploader(() => Promise.reject(new Error('part failed')))
    await expect(service.upload(uploadOf({ key: 'big.bin' }))).rejects.toMatchObject({
      code: 'STORAGE_MULTIPART_ABORTED',
    })
  })
})
