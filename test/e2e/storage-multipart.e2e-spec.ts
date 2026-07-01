/**
 * @fileoverview End-to-end multipart suite against a live MinIO container: the
 * automatic single-shot → multipart switch for large bodies, streaming uploads
 * without a declared size, and progress-event emission.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

const MB = 1024 * 1024

describe('Storage E2E — multipart', () => {
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

  it('switches to multipart for a body above the 5 MB threshold', async () => {
    // A 6 MB buffer takes the multipart pathway; the stored size matches.
    const size = 6 * MB
    const body = Buffer.alloc(size, 'a')
    const result = await storage.upload({
      key: 'e2e/multipart-6mb.bin',
      body,
      contentType: 'application/octet-stream',
      size,
    })
    expect(result.multipart).toBe(true)
    const head = await storage.head('e2e/multipart-6mb.bin')
    expect(head.size).toBe(size)
  }, 30_000)

  it('accepts a Readable stream without a declared size', async () => {
    // An unsized stream defaults to the multipart uploader.
    const chunks = Array.from({ length: 6 }, () => Buffer.alloc(MB, 'b'))
    const result = await storage.upload({
      key: 'e2e/stream.bin',
      body: Readable.from(chunks),
      contentType: 'application/octet-stream',
    })
    expect(result.multipart).toBe(true)
  }, 30_000)

  it('emits progress events during a multipart upload', async () => {
    // Progress fires at least once and the final loaded equals the total size.
    const events: { loaded: number }[] = []
    const size = 8 * MB
    await storage.upload({
      key: 'e2e/progress.bin',
      body: Buffer.alloc(size, 'c'),
      contentType: 'application/octet-stream',
      size,
      onProgress: (event) => events.push({ loaded: event.loaded }),
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events[events.length - 1]?.loaded).toBe(size)
  }, 30_000)
})
