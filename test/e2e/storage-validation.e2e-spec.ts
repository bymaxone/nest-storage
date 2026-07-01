/**
 * @fileoverview End-to-end validation-pipeline suite against a live MinIO
 * container: a MIME whitelist rejects a disallowed type, and a size cap rejects
 * an oversize upload — both before any bytes reach S3.
 * @layer test/e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — validation pipeline', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService

  beforeAll(async () => {
    minio = await startMinio()
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...providerRecipes.minio({
            endpoint: minio.endpoint,
            bucket: minio.bucket,
            accessKeyId: minio.accessKeyId,
            secretAccessKey: minio.secretAccessKey,
          }),
          validation: { mimeWhitelist: ['image/*'], maxSizeBytes: 1024 },
        }),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('rejects a MIME type outside the whitelist', async () => {
    // text/plain is not covered by image/* → STORAGE_MIME_NOT_ALLOWED.
    await expect(
      storage.upload({ key: 'a.txt', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
  })

  it('rejects an upload larger than maxSizeBytes', async () => {
    // A 2 KB body exceeds the 1 KB cap → STORAGE_SIZE_EXCEEDED.
    await expect(
      storage.upload({ key: 'a.png', body: Buffer.alloc(2048), contentType: 'image/png', size: 2048 }),
    ).rejects.toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
  })
})
