/**
 * @fileoverview A stream whose declared size is wrong, against a live MinIO: a body longer
 * than declared and one shorter both end in a typed error within a bounded time and leave no object,
 * and a body of exactly the declared size is stored whole. A provider stores an object once it has
 * received `Content-Length` bytes, so the last byte of a body is held back until the source has ended and
 * a longer body never completes its request. A multipart stream that ends early is aborted instead.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

/** The longest a refusal may take; far below `requestTimeoutMs`, so a wait for the server's timeout fails. */
const REFUSAL_BOUND_MS = 5_000

describe('Storage E2E — declared size of a stream', () => {
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
          requestTimeoutMs: 60_000,
          maxAttempts: 1,
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

  /** Runs the upload and returns what it rejected with and how long it took. */
  async function refusal(key: string, body: Readable, size: number): Promise<{ error: unknown; ms: number }> {
    const started = Date.now()
    const error: unknown = await storage
      .upload({ key, body, contentType: 'application/octet-stream', size })
      .catch((err: unknown) => err)
    return { error, ms: Date.now() - started }
  }

  it('refuses a body longer than declared with STORAGE_SIZE_EXCEEDED, in bounded time, and stores nothing', async () => {
    const { error, ms } = await refusal(
      'longer.bin',
      Readable.from([Buffer.alloc(3000, 1), Buffer.alloc(2000, 1)]),
      500,
    )

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED', status: 413 })
    expect(ms).toBeLessThan(REFUSAL_BOUND_MS)
    await expect(storage.exists('longer.bin')).resolves.toBe(false)
  })

  it('refuses a body shorter than declared with STORAGE_VALIDATION_FAILED, in bounded time, and stores nothing', async () => {
    const { error, ms } = await refusal('shorter.bin', Readable.from([Buffer.alloc(120, 1)]), 500)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400 })
    expect(ms).toBeLessThan(REFUSAL_BOUND_MS)
    await expect(storage.exists('shorter.bin')).resolves.toBe(false)
  })

  it('aborts a multipart upload whose stream ends before its declared size, and stores nothing', async () => {
    const mib = 1024 * 1024

    const { error, ms } = await refusal(
      'shorter-multipart.bin',
      Readable.from([Buffer.alloc(6 * mib, 3)]),
      12 * mib,
    )

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400 })
    expect(ms).toBeLessThan(REFUSAL_BOUND_MS)
    await expect(storage.exists('shorter-multipart.bin')).resolves.toBe(false)
  })

  it('stores a body of exactly the declared size, whole', async () => {
    await storage.upload({
      key: 'exact.bin',
      body: Readable.from([Buffer.alloc(300, 7), Buffer.alloc(200, 8)]),
      contentType: 'application/octet-stream',
      size: 500,
    })

    const { buffer } = await storage.downloadBuffer({ key: 'exact.bin' })
    expect(buffer).toEqual(Buffer.concat([Buffer.alloc(300, 7), Buffer.alloc(200, 8)]))
  })
})
