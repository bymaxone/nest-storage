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

  describe.each(['WHEN_REQUIRED', 'WHEN_SUPPORTED'] as const)(
    'the stored Content-Type is bound to the signature (%s)',
    (mode) => {
      let bound: TestingModule
      let boundSigned: SignedUrlService
      let boundStorage: StorageService

      beforeAll(async () => {
        bound = await Test.createTestingModule({
          imports: [
            BymaxStorageModule.forRoot({
              ...providerRecipes.minio({
                endpoint: minio.endpoint,
                bucket: minio.bucket,
                accessKeyId: minio.accessKeyId,
                secretAccessKey: minio.secretAccessKey,
              }),
              requestChecksumCalculation: mode,
            }),
          ],
        }).compile()
        await bound.init()
        boundSigned = bound.get(SignedUrlService)
        boundStorage = bound.get(StorageService)
      })

      afterAll(async () => {
        await bound.close()
      })

      const signedHeaders = (url: string): string[] =>
        (new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')

      it('lists content-type among the signed headers', async () => {
        // The URL holder must not be free to choose the type: the approved one is signed.
        const { url } = await boundSigned.getUploadUrl({
          key: `e2e/bound-${mode}-signed.png`,
          contentType: 'image/png',
          ttlSeconds: 60,
        })
        expect(signedHeaders(url)).toEqual(expect.arrayContaining(['content-type', 'host']))
      })

      it('stores an upload sent with the approved type', async () => {
        const key = `e2e/bound-${mode}-ok.png`
        const { url, requiredHeaders } = await boundSigned.getUploadUrl({
          key,
          contentType: 'image/png',
          ttlSeconds: 60,
        })
        const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'png-bytes' })
        expect(response.status).toBe(200)
        expect((await boundStorage.head(key)).contentType).toBe('image/png')
      })

      it('refuses an upload sent with another type, and stores nothing', async () => {
        const key = `e2e/bound-${mode}-other.png`
        const { url } = await boundSigned.getUploadUrl({ key, contentType: 'image/png', ttlSeconds: 60 })
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html' },
          body: '<script>1</script>',
        })
        expect(response.status).toBe(403)
        await expect(boundStorage.head(key)).rejects.toMatchObject({ code: 'STORAGE_OBJECT_NOT_FOUND' })
      })
    },
  )

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

  it('signs a request for more than 7 days with X-Amz-Expires=604800, and the server accepts it', async () => {
    // A ceiling above the SigV4 limit is capped at init, so a longer request yields a URL the signer
    // can produce and the server verifies, instead of an SDK rejection at sign time.
    const longLived = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...providerRecipes.minio({
            endpoint: minio.endpoint,
            bucket: minio.bucket,
            accessKeyId: minio.accessKeyId,
            secretAccessKey: minio.secretAccessKey,
          }),
          signedUrls: { maxTtlSeconds: 2_592_000 },
        }),
      ],
    }).compile()
    await longLived.init()
    try {
      const longStorage = longLived.get(StorageService)
      const longSigned = longLived.get(SignedUrlService)
      await longStorage.upload({ key: 'e2e/long-ttl.txt', body: Buffer.from('long'), contentType: 'text/plain' })

      const { url } = await longSigned.getDownloadUrl({ key: 'e2e/long-ttl.txt', ttlSeconds: 1_000_000 })

      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('604800')
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('long')
    } finally {
      await longLived.close()
    }
  })

  describe('a PUT URL that carries an ACL signs the x-amz-acl header', () => {
    // The ACL is part of the contract: the caller is told to send `x-amz-acl`, so the header is
    // signed with the URL. The suite proves that header contract. It does not assert a public
    // grant: MinIO does not implement object ACLs, so the stored ACL is owner-only whatever is sent.
    const upload = (key: string, extra: Record<string, unknown> = {}) =>
      signedUrls.getUploadUrl({ key, contentType: 'text/plain', ttlSeconds: 60, publicRead: true, ...extra })

    it('lists x-amz-acl among the signed headers and not in the query', async () => {
      const { url } = await upload('e2e/acl-signed-headers.txt')
      const params = new URL(url).searchParams
      expect((params.get('X-Amz-SignedHeaders') ?? '').split(';')).toEqual(
        expect.arrayContaining(['content-type', 'host', 'x-amz-acl']),
      )
      expect(params.has('x-amz-acl')).toBe(false)
    })

    it('stores an upload sent with exactly the headers it asked for', async () => {
      const key = 'e2e/acl-exact.txt'
      const { url, requiredHeaders } = await upload(key)
      expect(Object.keys(requiredHeaders).sort()).toEqual(['Content-Type', 'x-amz-acl'])
      const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'acl-exact' })
      expect(response.status).toBe(200)
      expect((await storage.head(key)).contentType).toBe('text/plain')
    })

    it('stores an upload with metadata sent with exactly the headers it asked for', async () => {
      const key = 'e2e/acl-metadata.txt'
      const { url, requiredHeaders } = await upload(key, { metadata: { color: 'red' } })
      const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'acl-metadata' })
      expect(response.status).toBe(200)
      expect((await storage.head(key)).metadata).toEqual({ color: 'red' })
    })

    it('refuses an upload that leaves the x-amz-acl header out, and stores nothing', async () => {
      const key = 'e2e/acl-omitted.txt'
      const { url } = await upload(key)
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
      expect(response.status).toBeGreaterThanOrEqual(400)
      await expect(storage.head(key)).rejects.toMatchObject({ code: 'STORAGE_OBJECT_NOT_FOUND' })
    })

    it('refuses an upload that sends another x-amz-acl value, and stores nothing', async () => {
      const key = 'e2e/acl-other-value.txt'
      const { url } = await upload(key)
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain', 'x-amz-acl': 'private' },
        body: 'x',
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
      await expect(storage.head(key)).rejects.toMatchObject({ code: 'STORAGE_OBJECT_NOT_FOUND' })
    })

    it('leaves a URL without an ACL as it was: Content-Type alone, no x-amz-acl signed', async () => {
      const key = 'e2e/no-acl.txt'
      const { url, requiredHeaders } = await upload(key, { publicRead: false })
      expect(requiredHeaders).toEqual({ 'Content-Type': 'text/plain' })
      expect((new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')).not.toContain('x-amz-acl')
      const response = await fetch(url, { method: 'PUT', headers: requiredHeaders, body: 'no-acl' })
      expect(response.status).toBe(200)
    })
  })
})
