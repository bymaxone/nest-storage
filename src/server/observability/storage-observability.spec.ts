/**
 * @fileoverview Every public operation of the services is counted under its own name through the module's own
 * tally, which the module exports for the `observability` subpath, and a scan is counted by its verdict.
 * @layer server/observability
 */
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { BucketLifecycleService } from '../services/bucket-lifecycle.service'
import { FileScannerService } from '../services/file-scanner.service'
import { S3ClientProvider } from '../providers/s3-client.provider'
import { SignedUrlService } from '../services/signed-url.service'
import { StorageService } from '../services/storage.service'
import { StorageMetricsTally } from './storage-metrics-tally'
import { STORAGE_OPERATIONS, type StorageOperation } from './storage-operations'

/** A module with no credentials: every operation fails at once with `STORAGE_NOT_CONFIGURED`. */
async function unconfigured(): Promise<TestingModule> {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  return Test.createTestingModule({
    imports: [
      BymaxStorageModule.forRoot({
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'b',
        credentials: { accessKeyId: '', secretAccessKey: '' },
      }),
    ],
  }).compile()
}

/** One call per operation, each made through the public method the operation is named for. */
function callsOf(moduleRef: TestingModule): Record<StorageOperation, () => Promise<unknown>> {
  const storage = moduleRef.get(StorageService)
  const signed = moduleRef.get(SignedUrlService)
  const lifecycle = moduleRef.get(BucketLifecycleService)
  return {
    upload: () => storage.upload({ key: 'a', body: Buffer.from('x'), contentType: 'text/plain' }),
    download: () => storage.download({ key: 'a' }),
    head: () => storage.head('a'),
    delete: () => storage.delete('a'),
    delete_many: () => storage.deleteMany(['a']),
    list: () => storage.list({ prefix: 'a' }),
    copy: () => storage.copy({ sourceKey: 'a', destinationKey: 'b' }),
    get_download_url: () => signed.getDownloadUrl({ key: 'a' }),
    get_upload_url: () => signed.getUploadUrl({ key: 'a', contentType: 'text/plain' }),
    get_multipart_upload_urls: () =>
      signed.getMultipartUploadUrls({ key: 'a', contentType: 'text/plain', parts: 1 }),
    check_bucket: () => storage.checkBucket(),
    lifecycle_get: () => lifecycle.get(),
    lifecycle_upsert: () => lifecycle.upsert({ id: 'r', prefix: 'a/', expirationDays: 1 }),
    lifecycle_remove: () => lifecycle.remove('r'),
  }
}

describe('the services report to the module tally', () => {
  it('exports one tally, and the services count into it', async () => {
    const moduleRef = await unconfigured()

    expect(moduleRef.get(StorageMetricsTally)).toBe(moduleRef.get(StorageMetricsTally))
    await moduleRef
      .get(StorageService)
      .head('a')
      .catch(() => undefined)

    expect(moduleRef.get(StorageMetricsTally).snapshot().operations.head.error).toBe(1)
  })

  it.each(STORAGE_OPERATIONS)(
    'counts %s under its own name, and under no other',
    async (operation) => {
      const moduleRef = await unconfigured()
      const tally = moduleRef.get(StorageMetricsTally)

      await callsOf(moduleRef)
        [operation]()
        .catch(() => undefined)

      const { operations } = tally.snapshot()
      for (const other of STORAGE_OPERATIONS) {
        const total = Object.values(operations[other]).reduce((sum, count) => sum + count, 0)
        expect({ operation: other, total }).toEqual({
          operation: other,
          total: other === operation ? 1 : 0,
        })
      }
      expect(operations[operation].error).toBe(1)
    },
  )

  it('counts the scan verdict of a scanner that answers clean', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'b',
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          scanner: {
            impl: { scan: () => Promise.resolve({ status: 'clean' as const, engine: 'test' }) },
            mode: 'pre-upload',
          },
        }),
      ],
    }).compile()

    await moduleRef.get(FileScannerService).scan({
      mode: 'pre-upload',
      key: 'a',
      bucket: 'b',
      contentType: 'text/plain',
      body: Buffer.from('x'),
    })

    expect(moduleRef.get(StorageMetricsTally).snapshot().scans.clean).toBe(1)
  })

  it('adds the bytes of an upload once, and not again for a result the idempotency cache answers', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const send = jest.fn().mockResolvedValue({ ETag: '"e"' })
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: 'https://s3.example.com',
          region: 'us-east-1',
          bucket: 'b',
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
        }),
      ],
    })
      .overrideProvider(S3ClientProvider)
      .useValue({
        isConfigured: () => true,
        getClient: () => ({ send }),
        getClientOrNull: () => null,
      })
      .compile()
    const upload = (): Promise<unknown> =>
      moduleRef.get(StorageService).upload({
        key: 'a',
        body: Buffer.from('hello'),
        contentType: 'text/plain',
        idempotencyKey: 'once',
      })

    await upload()
    await upload()

    const snapshot = moduleRef.get(StorageMetricsTally).snapshot()
    expect(send).toHaveBeenCalledTimes(1)
    expect(snapshot.operations.upload.success).toBe(2)
    expect(snapshot.bytesUploaded).toBe(5)
  })
})
