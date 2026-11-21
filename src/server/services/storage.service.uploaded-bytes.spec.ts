/**
 * @fileoverview The upload byte counter counts what the transfer sent: a stream without a declared size is counted
 * from the uploader's own progress, a declared size the transfer did not reach is not counted, and an upload that
 * failed counts nothing. The `Upload` class of `@aws-sdk/lib-storage` is replaced by a fake that reports progress.
 * @layer server/services
 */
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { Logger } from '@nestjs/common'
import { StorageService } from './storage.service'
import { applyDefaults } from '../config/apply-defaults'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { StorageMetricsTally } from '../observability/storage-metrics-tally'
import { StorageObserver } from '../observability/storage-observer'
import { StorageTracing } from '../observability/storage-tracing'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }))

const UploadMock = Upload as unknown as jest.Mock

type Listener = (event: { loaded?: number; total?: number; part?: number }) => void

/** Installs a fake uploader that reports `loaded` bytes in steps, then finishes or fails. */
function uploaderSending(steps: (number | undefined)[], outcome: 'done' | 'fail' = 'done'): void {
  const listeners: Listener[] = []
  const uploader: Record<string, unknown> = {
    on: jest.fn((event: string, listener: Listener): unknown => {
      if (event === 'httpUploadProgress') listeners.push(listener)
      return uploader
    }),
    done: jest.fn(() => {
      for (const loaded of steps)
        for (const listener of listeners) listener(loaded === undefined ? {} : { loaded })
      return outcome === 'done'
        ? Promise.resolve({ ETag: '"e"' })
        : Promise.reject(new Error('refused'))
    }),
    abort: jest.fn(() => Promise.resolve()),
    uploadId: 'u-1',
  }
  UploadMock.mockImplementation(() => uploader)
}

/** A service that reports to a tally, over a client that never answers (the uploader is the fake). */
function serviceWithTally(): { service: StorageService; tally: StorageMetricsTally } {
  const options = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  const client = { send: jest.fn().mockResolvedValue({}) } as unknown as S3Client
  const provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  const validation = {
    validate: jest.fn((input: { body: unknown }) => Promise.resolve({ body: input.body })),
    checkHeaders: jest.fn(),
  } as unknown as ValidationService
  const scanner = { isEnabled: jest.fn().mockReturnValue(false) } as unknown as FileScannerService
  const tally = new StorageMetricsTally()
  const service = new StorageService(
    options,
    provider,
    new KeyResolverService(options),
    new IdempotencyCache(100, 60_000, () => 0),
    validation,
    scanner,
    new StorageObserver(tally, new StorageTracing()),
  )
  return { service, tally }
}

describe('bytes uploaded by a multipart upload', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  it('counts a stream without a declared size from the progress the uploader reported', async () => {
    uploaderSending([500])
    const { service, tally } = serviceWithTally()

    const result = await service.upload({
      key: 'a',
      body: Readable.from([Buffer.alloc(500)]),
      contentType: 'x/y',
    })

    expect(result.multipart).toBe(true)
    expect(tally.snapshot().bytesUploaded).toBe(500)
  })

  it('keeps the last count when an event carries none', async () => {
    uploaderSending([500, undefined])
    const { service, tally } = serviceWithTally()

    await service.upload({ key: 'a', body: Readable.from([Buffer.alloc(500)]), contentType: 'x/y' })

    expect(tally.snapshot().bytesUploaded).toBe(500)
  })

  it('counts the last progress of a multi-part transfer, not the sum of the steps', async () => {
    const seven = 7 * 1024 * 1024
    uploaderSending([5 * 1024 * 1024, seven])
    const { service, tally } = serviceWithTally()

    await service.upload({ key: 'a', body: Readable.from([Buffer.alloc(1)]), contentType: 'x/y' })

    expect(tally.snapshot().bytesUploaded).toBe(seven)
  })

  it('counts what the transfer sent, not a declared size it did not reach', async () => {
    const MIB = 1024 * 1024
    uploaderSending([6 * MIB])
    const { service, tally } = serviceWithTally()

    // A declared size at or above the multipart threshold takes the multipart path, which uploads a short stream as it is.
    await service.upload({
      key: 'a',
      body: Readable.from([Buffer.alloc(1)]),
      contentType: 'x/y',
      size: 10 * MIB,
    })

    expect(tally.snapshot().bytesUploaded).toBe(6 * MIB)
  })

  it('counts nothing for an upload that failed after sending some bytes', async () => {
    uploaderSending([3_000], 'fail')
    const { service, tally } = serviceWithTally()

    await service
      .upload({ key: 'a', body: Readable.from([Buffer.alloc(1)]), contentType: 'x/y' })
      .catch(() => undefined)

    expect(tally.snapshot().bytesUploaded).toBe(0)
  })

  it('counts nothing when the uploader reported no progress', async () => {
    uploaderSending([])
    const { service, tally } = serviceWithTally()

    await service.upload({
      key: 'a',
      body: Readable.from([Buffer.alloc(1)]),
      contentType: 'x/y',
      size: 10 * 1024 * 1024,
    })

    expect(tally.snapshot().bytesUploaded).toBe(0)
  })

  it('still counts the size of a single-shot upload', async () => {
    const { service, tally } = serviceWithTally()

    const result = await service.upload({
      key: 'a',
      body: Buffer.from('hello'),
      contentType: 'x/y',
    })

    expect(result.multipart).toBe(false)
    expect(tally.snapshot().bytesUploaded).toBe(5)
  })
})
