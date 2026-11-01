/**
 * @fileoverview End-to-end behaviour for a bucket that does not exist, against a live
 * MinIO-compatible container: operations that receive an error body report
 * `STORAGE_BUCKET_NOT_FOUND`, `delete()` rejects it, `head()` and `exists()` read it
 * as an absent object (a HEAD response has no body), and `checkBucket()` tells the two apart.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  providerRecipes,
  StorageException,
  StorageService,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

const MISSING = 'bucket-that-does-not-exist'

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'resolved'
  } catch (err) {
    return err instanceof StorageException ? err.code : `not a StorageException: ${String(err)}`
  }
}

describe('Storage E2E — missing bucket', () => {
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

  it('checkBucket() resolves for the bucket that exists', async () => {
    await expect(storage.checkBucket()).resolves.toBeUndefined()
  })

  it('checkBucket() rejects STORAGE_BUCKET_NOT_FOUND for a bucket that does not', async () => {
    expect(await codeOf(storage.checkBucket({ bucket: MISSING }))).toBe('STORAGE_BUCKET_NOT_FOUND')
  })

  it.each([
    ['download', () => storage.download({ key: 'a.txt', bucket: MISSING })],
    ['list', () => storage.list({ bucket: MISSING })],
    ['delete', () => storage.delete('a.txt', { bucket: MISSING })],
    [
      'multipart upload',
      () =>
        storage.upload({
          key: 'a.txt',
          body: Readable.from([Buffer.from('x')]),
          contentType: 'text/plain',
          bucket: MISSING,
        }),
    ],
    [
      'upload',
      () =>
        storage.upload({
          key: 'a.txt',
          body: Buffer.from('x'),
          contentType: 'text/plain',
          bucket: MISSING,
        }),
    ],
  ])('%s reports STORAGE_BUCKET_NOT_FOUND', async (_name, call) => {
    expect(await codeOf(call())).toBe('STORAGE_BUCKET_NOT_FOUND')
  })

  it('head() and exists() still read a missing bucket as an absent object', async () => {
    expect(await codeOf(storage.head('a.txt', { bucket: MISSING }))).toBe(
      'STORAGE_OBJECT_NOT_FOUND',
    )
    await expect(storage.exists('a.txt', { bucket: MISSING })).resolves.toBe(false)
  })

  it('a missing key in an existing bucket is still an absent object, and delete() stays idempotent', async () => {
    expect(await codeOf(storage.download({ key: 'never-uploaded.txt' }))).toBe(
      'STORAGE_OBJECT_NOT_FOUND',
    )
    await expect(storage.delete('never-uploaded.txt')).resolves.toBeUndefined()
  })
})
