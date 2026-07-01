/**
 * @fileoverview End-to-end signed-URL suite against a live MinIO container:
 * a presigned GET fetched over real HTTP, a presigned PUT upload, and rejection
 * of a PUT whose SigV4 signature has been tampered with.
 * @layer test/e2e
 */
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule, SignedUrlService, StorageService, providerRecipes } from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

describe('Storage E2E — signed URLs', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService
  let signedUrls: SignedUrlService

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
    signedUrls = moduleRef.get(SignedUrlService)
  }, 60_000)

  afterAll(async () => {
    await moduleRef.close()
    await minio.container.stop()
  })

  it('issues a GET signed URL that fetches the object body', async () => {
    // A presigned GET returns the stored bytes over real HTTP.
    await storage.upload({ key: 'e2e/signed-get.txt', body: Buffer.from('hello'), contentType: 'text/plain' })
    const { url } = await signedUrls.getDownloadUrl({ key: 'e2e/signed-get.txt', ttlSeconds: 60 })
    const response = await fetch(url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('hello')
  })

  it('issues a PUT signed URL that uploads the object', async () => {
    // A presigned PUT stores bytes that the library can then download.
    const { url, requiredHeaders } = await signedUrls.getUploadUrl({
      key: 'e2e/signed-put.txt',
      contentType: 'text/plain',
      ttlSeconds: 60,
    })
    const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'signed-put-body' })
    expect(response.status).toBe(200)
    const { buffer } = await storage.downloadBuffer({ key: 'e2e/signed-put.txt' })
    expect(buffer.toString('utf-8')).toBe('signed-put-body')
  })

  it('rejects a PUT whose signature has been tampered with', async () => {
    // A signed URL is a real credential: corrupting the SigV4 signature fails.
    const { url, requiredHeaders } = await signedUrls.getUploadUrl({
      key: 'e2e/signed-put-tampered.txt',
      contentType: 'text/plain',
      ttlSeconds: 60,
    })
    const tampered = url.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'0'.repeat(64)}`)
    const response = await fetch(tampered, { method: 'PUT', headers: requiredHeaders, body: 'x' })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
