/**
 * @fileoverview The size the scanner is told: a buffer's own length, however it was declared, and
 * none for a stream whose length nobody declared. The multipart upload class is mocked so the
 * stream case makes no request.
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
import type { ValidationService } from './validation.service'
import type { FileScannerService } from './file-scanner.service'

jest.mock('@aws-sdk/lib-storage', () => ({ Upload: jest.fn() }))

/** A service whose scanner records its input, in the given mode, with a validation that accepts anything. */
function makeService(mode: 'pre-upload' | 'post-upload'): { service: StorageService; scan: jest.Mock } {
  const scan = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
  const scanner = { isEnabled: () => true, getMode: () => mode, scan } as unknown as FileScannerService
  ;(Upload as unknown as jest.Mock).mockImplementation(() => ({
    on: jest.fn(),
    done: jest.fn().mockResolvedValue({ ETag: '"m"' }),
  }))
  const resolved = applyDefaults({
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  })
  const s3Provider = {
    isConfigured: (): boolean => true,
    getClient: (): S3Client => ({ send: jest.fn().mockResolvedValue({ ETag: '"e"' }) }) as unknown as S3Client,
  } as unknown as S3ClientProvider
  const validation = {
    validate: (input: { body: unknown }) => Promise.resolve({ body: input.body }),
  } as unknown as ValidationService
  const service = new StorageService(
    resolved,
    s3Provider,
    new KeyResolverService(resolved),
    new IdempotencyCache(10, 1000, () => 0),
    validation,
    scanner,
  )
  return { service, scan }
}

describe('StorageService — size in the scan input', () => {
  it.each(['pre-upload', 'post-upload'] as const)(
    'passes a buffer\'s own length to the %s scan, though none was declared',
    async (mode) => {
      // A buffer is measured on entry, so the scanner is told its real length.
      const { service, scan } = makeService(mode)

      await service.upload({ key: 'a.txt', body: Buffer.from('hi'), contentType: 'text/plain' })

      const [[arg]] = scan.mock.calls as [[Record<string, unknown>]]
      expect(arg.size).toBe(2)
    },
  )

  it('omits size from the post-upload scan when a stream\'s length was never declared', async () => {
    // The conditional spread must not inject a `size: undefined` key.
    const { service, scan } = makeService('post-upload')

    await service.upload({ key: 'a.bin', body: Readable.from([Buffer.from('hi')]), contentType: 'text/plain' })

    const [[arg]] = scan.mock.calls as [[Record<string, unknown>]]
    expect('size' in arg).toBe(false)
  })
})
