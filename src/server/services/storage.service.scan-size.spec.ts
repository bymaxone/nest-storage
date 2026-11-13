/**
 * @fileoverview The post-upload scan input carries a size only when one is known: none for a
 * stream whose length nobody declared, which takes the multipart path. The multipart upload
 * class is mocked so no request is made.
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

describe('StorageService — post-upload scan input', () => {
  it('omits size when the stream\'s length was never declared', async () => {
    // The conditional spread must not inject a `size: undefined` key.
    const scan = jest.fn().mockResolvedValue({ status: 'clean', engine: 'test' })
    const scanner = {
      isEnabled: () => true,
      getMode: () => 'post-upload',
      scan,
    } as unknown as FileScannerService
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
      getClient: (): S3Client => ({ send: jest.fn() }) as unknown as S3Client,
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

    await service.upload({ key: 'a.bin', body: Readable.from([Buffer.from('hi')]), contentType: 'text/plain' })

    const [[arg]] = scan.mock.calls as [[Record<string, unknown>]]
    expect('size' in arg).toBe(false)
  })
})
