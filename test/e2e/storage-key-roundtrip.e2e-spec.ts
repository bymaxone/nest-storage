/**
 * @fileoverview End-to-end checks against a live MinIO-compatible container for the
 * behaviour that depends on a real server: with a `keyPrefix`, every key the library
 * returns can be passed back; conditional reads give typed 304 / 412 outcomes; and a
 * stream scanned before upload is stored whole.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  SignedUrlService,
  StorageService,
  providerRecipes,
  type IFileScanner,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — keyPrefix round trip, conditional reads, scanned streams', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService
  let signedUrls: SignedUrlService
  const scanned: number[] = []

  const scanner: IFileScanner = {
    async scan(input) {
      let bytes = 0
      if (input.body && !Buffer.isBuffer(input.body)) {
        for await (const chunk of input.body) {
          bytes += (chunk as Buffer).length
        }
      } else if (input.body) {
        bytes = input.body.length
      }
      scanned.push(bytes)
      return { status: 'clean', engine: 'e2e' }
    },
  }

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
          keyPrefix: 'tenant-a',
          validation: { maxSizeBytes: 1_000_000 },
          scanner: { impl: scanner, mode: 'pre-upload' },
        }),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
    signedUrls = moduleRef.get(SignedUrlService)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('passes every returned key straight back to head, exists, download, signed GET, copy and delete', async () => {
    const uploaded = await storage.upload({
      key: 'docs/a.txt',
      body: Buffer.from('round trip'),
      contentType: 'text/plain',
    })
    expect(uploaded.key).toBe('docs/a.txt')

    const head = await storage.head(uploaded.key)
    expect(head.key).toBe('docs/a.txt')
    expect(head.size).toBe(10)
    await expect(storage.exists(uploaded.key)).resolves.toBe(true)
    const { buffer } = await storage.downloadBuffer({ key: uploaded.key })
    expect(buffer.toString()).toBe('round trip')
    const { url } = await signedUrls.getDownloadUrl({ key: uploaded.key, ttlSeconds: 60 })
    expect(await (await fetch(url)).text()).toBe('round trip')
    await storage.copy({ sourceKey: uploaded.key, destinationKey: 'docs/b.txt' })

    await storage.delete(uploaded.key)
    await expect(storage.exists(uploaded.key)).resolves.toBe(false)
    await expect(storage.exists('docs/b.txt')).resolves.toBe(true)
  })

  it('passes a listed key straight back to download, and the listing omits the prefix', async () => {
    await storage.upload({ key: 'listed/x.txt', body: Buffer.from('x'), contentType: 'text/plain' })

    const page = await storage.list({ prefix: 'listed/' })
    const listedKey = page.objects[0]?.key ?? ''

    expect(listedKey).toBe('listed/x.txt')
    const { buffer } = await storage.downloadBuffer({ key: listedKey })
    expect(buffer.toString()).toBe('x')
  })

  it('keeps the public URL complete, with the prefix in the object path', async () => {
    const uploaded = await storage.upload({ key: 'pub.txt', body: Buffer.from('p'), contentType: 'text/plain' })

    expect(uploaded.publicUrl).toContain('/tenant-a/pub.txt')
  })

  it('maps a matching If-None-Match to STORAGE_NOT_MODIFIED and a failing If-Match to STORAGE_PRECONDITION_FAILED', async () => {
    const uploaded = await storage.upload({ key: 'cond.txt', body: Buffer.from('c'), contentType: 'text/plain' })

    const notModified: unknown = await storage
      .download({ key: 'cond.txt', ifNoneMatch: uploaded.etag })
      .catch((err: unknown) => err)
    const failed: unknown = await storage
      .download({ key: 'cond.txt', ifMatch: '"not-the-etag"' })
      .catch((err: unknown) => err)

    expect(notModified).toMatchObject({ code: 'STORAGE_NOT_MODIFIED', status: 304 })
    expect(failed).toMatchObject({ code: 'STORAGE_PRECONDITION_FAILED', status: 412 })
  })

  it('stores every byte of a stream the pre-upload scanner has read', async () => {
    const payload = Buffer.alloc(200_000, 9)
    scanned.length = 0

    const uploaded = await storage.upload({
      key: 'scanned/stream.bin',
      body: Readable.from([payload.subarray(0, 70_000), payload.subarray(70_000)]),
      contentType: 'application/octet-stream',
    })

    expect(scanned).toEqual([200_000])
    const { buffer } = await storage.downloadBuffer({ key: uploaded.key })
    expect(buffer.equals(payload)).toBe(true)
  })

  it('refuses a stream longer than maxSizeBytes without storing anything', async () => {
    const error: unknown = await storage
      .upload({
        key: 'scanned/too-big.bin',
        body: Readable.from([Buffer.alloc(600_000, 1), Buffer.alloc(600_000, 2)]),
        contentType: 'application/octet-stream',
      })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    await expect(storage.exists('scanned/too-big.bin')).resolves.toBe(false)
  })

  it('rejects a part count outside 1 to 10000 before any request', async () => {
    const error: unknown = await signedUrls
      .getMultipartUploadUrls({ key: 'mp.bin', contentType: 'application/octet-stream', parts: 10_001 })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_INVALID_PART_COUNT' })
  })
})
