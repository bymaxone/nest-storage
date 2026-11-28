/**
 * @fileoverview Unit tests for how `StorageService` uses the file scanner on upload. The S3
 * client is a hand-rolled `send` spy (no `aws-sdk-client-mock`).
 * @layer server/services
 */
import { Readable } from 'node:stream'
import { Logger } from '@nestjs/common'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
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
    validate: jest
      .fn()
      .mockImplementation((input: { body: unknown }) => Promise.resolve({ body: input.body })),
    checkHeaders: jest.fn(),
  } as unknown as ValidationService
}

/** Extracts the `error.details` map from a rejected StorageException promise. */
function detailsOf(err: unknown): Record<string, unknown> {
  return (
    ((err as StorageException).getResponse() as { error: { details?: Record<string, unknown> } })
      .error.details ?? {}
  )
}

describe('StorageService — scan integration', () => {
  /** Builds a service wired with a custom scanner instead of the disabled stub. */
  function makeServiceWithScanner(
    scanner: FileScannerService,
    extra: Partial<BymaxStorageModuleOptions> = {},
  ): { service: StorageService; send: jest.Mock } {
    const resolved = applyDefaults({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'test-bucket',
      credentials: { accessKeyId: 'k', secretAccessKey: 's' },
      publicBaseUrl: 'https://cdn.example.com',
      ...extra,
    })
    const send = jest.fn().mockResolvedValue({ ETag: '"abc"' })
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
      scanner,
    )
    return { service, send }
  }

  it('calls scan with mode "pre-upload" when pre-upload scanner is enabled (with size)', async () => {
    // scan() must be invoked before the S3 PutObject send when mode is pre-upload
    const scanFn = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('pre-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner)

    await service.upload({
      key: 'a.txt',
      body: Buffer.from('hi'),
      contentType: 'text/plain',
      size: 2,
    })

    expect(scanFn).toHaveBeenCalledTimes(1)
    expect(scanFn).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'pre-upload', key: 'a.txt', size: 2 }),
      { key: 'a.txt' },
    )
    expect(send).toHaveBeenCalled()
  })

  it('calls scan with mode "pre-upload" omitting size when not provided', async () => {
    // scan input must omit the size key when the upload has no known size
    const scanFn = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('pre-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service } = makeServiceWithScanner(scanner, { validation: { maxSizeBytes: 100 } })

    // A stream carries no size; a buffer always does (its own length), so only a stream tests this.
    await service.upload({
      key: 'a.txt',
      body: Readable.from([Buffer.from('hi')]),
      contentType: 'text/plain',
    })

    expect(scanFn).toHaveBeenCalledTimes(1)
    const [[scanArg]] = scanFn.mock.calls as [[Record<string, unknown>]]
    expect(scanArg).not.toHaveProperty('size')
  })

  it('normalizes a Uint8Array body to a Buffer before the pre-upload scan', async () => {
    // the scanner contract accepts Buffer | stream only, so a Uint8Array upload
    // must reach it as a Buffer rather than a raw Uint8Array
    const scanFn = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('pre-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service } = makeServiceWithScanner(scanner)

    await service.upload({
      key: 'a.txt',
      body: new Uint8Array([104, 105]),
      contentType: 'text/plain',
    })

    const [[scanArg]] = scanFn.mock.calls as [[{ body: unknown }]]
    expect(Buffer.isBuffer(scanArg.body)).toBe(true)
  })

  it('hands the pre-upload scan and the upload the same buffered bytes of a stream body', async () => {
    // A stream is single-use: the scanner and the upload must share one Buffer, not one stream.
    const scanFn = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('pre-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner, {
      validation: { maxSizeBytes: 1024 },
    })
    const stream = Readable.from([Buffer.from('h'), Buffer.from('i')])

    await service.upload({ key: 'a.txt', body: stream, contentType: 'text/plain', size: 2 })

    const [[scanArg]] = scanFn.mock.calls as [[{ body: unknown }]]
    expect(Buffer.isBuffer(scanArg.body)).toBe(true)
    expect((scanArg.body as Buffer).toString()).toBe('hi')
    const [[command]] = send.mock.calls as [[{ input: { Body: unknown } }]]
    expect(command.input.Body).toBe(scanArg.body)
  })

  it('calls scan with mode "post-upload" after the object has been uploaded (no size)', async () => {
    // scan() must be invoked after S3 PutObject send when mode is post-upload
    const callOrder: string[] = []
    const scanFn = jest.fn().mockImplementation(() => {
      callOrder.push('scan')
      return Promise.resolve({ status: 'clean', engine: 'test' })
    })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('post-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner)
    send.mockImplementation((..._args: unknown[]) => {
      callOrder.push('send')
      return Promise.resolve({ ETag: '"abc"' })
    })

    await service.upload({ key: 'a.txt', body: Buffer.from('hi'), contentType: 'text/plain' })

    expect(callOrder).toEqual(['send', 'scan'])
  })

  it('includes size in post-upload scan input when upload provides a size', async () => {
    // size must be forwarded to scan so the scanner can validate it
    const scanFn = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('post-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service } = makeServiceWithScanner(scanner)

    await service.upload({
      key: 'a.txt',
      body: Buffer.from('hi'),
      contentType: 'text/plain',
      size: 2,
    })

    expect(scanFn).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'post-upload', key: 'a.txt', size: 2 }),
      { key: 'a.txt' },
    )
  })

  it('cleans up the infected object from the per-call bucket, not the module default', async () => {
    // The post-upload cleanup delete must target the SAME bucket the upload used — the
    // `{ bucket }` override, not `{}` (which would fall back to the default bucket).
    const infected = new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
      engine: 'test',
      threat: 'Virus.Z',
    })
    const scanFn = jest.fn().mockRejectedValue(infected)
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('post-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner)

    await service
      .upload({
        key: 'infected.bin',
        body: Buffer.from('evil'),
        contentType: 'application/octet-stream',
        bucket: 'override-bucket',
      })
      .catch(() => null)

    // send #1 = PutObject, send #2 = DeleteObject cleanup — both against override-bucket.
    const deleteInput = (send.mock.calls[1] as [{ input: Record<string, unknown> }])[0].input
    expect(deleteInput.Bucket).toBe('override-bucket')
  })

  it('deletes the object and rethrows when post-upload scan detects infection', async () => {
    // infected object must be removed from the bucket before the exception propagates
    const infected = new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
      engine: 'test',
      threat: 'Virus.X',
    })
    const scanFn = jest.fn().mockRejectedValue(infected)
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('post-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner)

    const err = await service
      .upload({
        key: 'infected.bin',
        body: Buffer.from('evil'),
        contentType: 'application/octet-stream',
      })
      .catch((e: unknown) => e)

    expect(err).toBe(infected)
    // first call is PutObject; second call is the DeleteObject cleanup
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('keeps the scan verdict as the error and says the object is still stored when the post-upload delete fails', async () => {
    // The delete failure is logged and reported in the error details; the verdict code is kept.
    const infected = new StorageException(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED, undefined, {
      engine: 'test',
      threat: 'Virus.Y',
    })
    const scanFn = jest.fn().mockRejectedValue(infected)
    const scanner: FileScannerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      getMode: jest.fn().mockReturnValue('post-upload'),
      scan: scanFn,
    } as unknown as FileScannerService
    const { service, send } = makeServiceWithScanner(scanner)
    // PutObject succeeds; DeleteObject fails
    send
      .mockResolvedValueOnce({ ETag: '"abc"' })
      .mockRejectedValueOnce(new Error('delete forbidden'))
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    const err = await service
      .upload({
        key: 'infected2.bin',
        body: Buffer.from('evil'),
        contentType: 'application/octet-stream',
      })
      .catch((e: unknown) => e)

    expect((err as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_SCAN_INFECTED)
    expect(detailsOf(err)).toMatchObject({
      engine: 'test',
      threat: 'Virus.Y',
      key: 'infected2.bin',
      cleanup: 'failed',
    })
    // The delete failure is logged at error level as an entry with a stable event and the stored key.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'STORAGE_SCAN_CLEANUP_FAILED',
        storedKey: expect.stringContaining('infected2.bin') as string,
      }),
    )
    errorSpy.mockRestore()
  })
})
