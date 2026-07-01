/**
 * @fileoverview End-to-end basic-operations suite against a live MinIO
 * container: upload → head → downloadBuffer → idempotent delete, path-traversal
 * rejection, and metadata round-tripping.
 * @layer test/e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — basic ops', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService

  beforeAll(async () => {
    minio = await startMinio()
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot(
          providerRecipes.minio({
            endpoint: minio.endpoint,
            bucket: minio.bucket,
            accessKeyId: minio.accessKeyId,
            secretAccessKey: minio.secretAccessKey,
          }),
        ),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('uploads, heads, downloads, and idempotently deletes a small object', async () => {
    // Single-shot round-trip; the second delete is a no-op, not an error.
    const body = Buffer.from('e2e content', 'utf-8')
    const uploaded = await storage.upload({ key: 'e2e/a.txt', body, contentType: 'text/plain' })
    expect(uploaded.multipart).toBe(false)
    expect(uploaded.etag).toBeTruthy()

    const head = await storage.head('e2e/a.txt')
    expect(head.size).toBe(body.byteLength)
    expect(head.contentType).toBe('text/plain')

    const { buffer } = await storage.downloadBuffer({ key: 'e2e/a.txt' })
    expect(buffer.toString('utf-8')).toBe('e2e content')

    await storage.delete('e2e/a.txt')
    await storage.delete('e2e/a.txt')
    expect(await storage.exists('e2e/a.txt')).toBe(false)
  })

  it('rejects a path-traversal key before it reaches S3', async () => {
    // The KeyResolver guard blocks `..` segments with STORAGE_KEY_INVALID.
    await expect(
      storage.upload({ key: '../etc/passwd', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' })
  })

  it('preserves custom metadata through a round-trip', async () => {
    // x-amz-meta-* metadata survives upload and head.
    await storage.upload({
      key: 'e2e/meta.txt',
      body: Buffer.from('x'),
      contentType: 'text/plain',
      metadata: { author: 'tester' },
    })
    const head = await storage.head('e2e/meta.txt')
    expect(head.metadata['author']).toBe('tester')
  })
})
