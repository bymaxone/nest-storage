/**
 * @fileoverview The log events `StorageService` writes when it absorbs a failure instead of throwing:
 * `exists()` answering `false` on a failure that is not a 404, and an idempotent `delete()` of a missing key.
 * @layer server/services
 */
import { Logger } from '@nestjs/common'
import type { S3Client } from '@aws-sdk/client-s3'
import { StorageService } from './storage.service'
import { KeyResolverService } from './key-resolver.service'
import { IdempotencyCache } from '../utils/idempotency-cache'
import { applyDefaults } from '../config/apply-defaults'
import type { S3ClientProvider } from '../providers/s3-client.provider'
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

const NOT_FOUND = { name: 'NotFound', $metadata: { httpStatusCode: 404 } }
const SERVER_ERROR = { name: 'InternalError', message: 'boom', $metadata: { httpStatusCode: 500 } }

/** A service over a `send` spy that rejects with `failure`. */
function serviceFailingWith(failure: unknown): StorageService {
  const options = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'test-bucket',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  const client = { send: jest.fn().mockRejectedValue(failure) } as unknown as S3Client
  const provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => client,
  } as unknown as S3ClientProvider
  const validation = {
    validate: jest.fn(),
    checkHeaders: jest.fn(),
  } as unknown as ValidationService
  const scanner = { isEnabled: jest.fn().mockReturnValue(false) } as unknown as FileScannerService
  return new StorageService(
    options,
    provider,
    new KeyResolverService(options),
    new IdempotencyCache(100, 60_000, () => 0),
    validation,
    scanner,
  )
}

describe('StorageService log events', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('exists returns false and logs STORAGE_EXISTS_FAILED on a non-404 error', async () => {
    // The failed call is logged as it is mapped, then exists() logs that it treats the error as "false".
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(serviceFailingWith(SERVER_ERROR).exists('a.txt')).resolves.toBe(false)

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'STORAGE_EXISTS_FAILED',
        message: expect.stringContaining('treating a non-404') as string,
        err: expect.any(Error) as Error,
      }),
    )
  })

  it('delete is idempotent on a 404 and logs STORAGE_DELETE_NOT_FOUND without the key', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(serviceFailingWith(NOT_FOUND).delete('missing')).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'STORAGE_DELETE_NOT_FOUND',
        message: expect.stringContaining('key not found (idempotent no-op)') as string,
      }),
    )
    expect(JSON.stringify(warn.mock.calls[0]?.[0])).not.toContain('missing')
  })
})
