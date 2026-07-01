/**
 * @fileoverview End-to-end list/copy/deleteMany suite against a live MinIO
 * container: prefix listing, continuation-token pagination, a server-side copy
 * round-trip, and a mixed batch delete.
 * @layer test/e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — list + copy + deleteMany', () => {
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

  beforeEach(async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        storage.upload({
          key: `list-test/${String(i)}.txt`,
          body: Buffer.from(String(i)),
          contentType: 'text/plain',
        }),
      ),
    )
  })

  it('lists every object under a prefix on a single page', async () => {
    // Five seeded objects, no truncation.
    const result = await storage.list({ prefix: 'list-test/' })
    expect(result.objects.length).toBe(5)
    expect(result.isTruncated).toBe(false)
  })

  it('paginates with maxKeys and a continuation token', async () => {
    // Page one truncates and yields a token; page two fetches the rest.
    const page1 = await storage.list({ prefix: 'list-test/', maxKeys: 2 })
    expect(page1.objects.length).toBe(2)
    expect(page1.isTruncated).toBe(true)
    const token = page1.nextContinuationToken
    expect(token).toBeTruthy()

    const page2 = await storage.list({
      prefix: 'list-test/',
      maxKeys: 2,
      ...(token !== undefined ? { continuationToken: token } : {}),
    })
    expect(page2.objects.length).toBe(2)
  })

  it('copies an object server-side', async () => {
    // The copied object carries the source bytes.
    await storage.upload({ key: 'src.txt', body: Buffer.from('src'), contentType: 'text/plain' })
    await storage.copy({ sourceKey: 'src.txt', destinationKey: 'dst.txt' })
    const { buffer } = await storage.downloadBuffer({ key: 'dst.txt' })
    expect(buffer.toString('utf-8')).toBe('src')
  })

  it('deletes a mixed batch of keys', async () => {
    // Present keys land in `deleted`; S3 reports a missing key as deleted too.
    const result = await storage.deleteMany(['list-test/0.txt', 'list-test/1.txt', 'list-test/missing.txt'])
    expect(result.deleted.length).toBeGreaterThanOrEqual(2)
    expect(result.failed).toEqual([])
  })
})
