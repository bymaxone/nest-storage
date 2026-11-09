/**
 * @fileoverview Header-bound values against a live MinIO: the documented ways to carry a non-ASCII
 * filename (RFC 6266 `filename*`) and non-ASCII metadata (percent-encoded) round-trip, while a line
 * break or a non-ASCII character in a header-bound option is refused before any request. The reflected
 * response headers of a signed GET are read back from the provider.
 * @layer test/e2e
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  SignedUrlService,
  StorageService,
  providerRecipes,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'

const FILENAME_STAR = "attachment; filename*=UTF-8''caf%C3%A9.pdf"

describe('Storage E2E — header values', () => {
  let minio: MinioHandle
  let moduleRef: TestingModule
  let storage: StorageService
  let signed: SignedUrlService
  let root: S3Client

  beforeAll(async () => {
    minio = await startMinio('headers')
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
    signed = moduleRef.get(SignedUrlService)
    root = new S3Client({
      endpoint: minio.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }, 120_000)

  afterAll(async () => {
    root.destroy()
    await moduleRef.close()
    await minio.container.stop()
  })

  it('stores a percent-encoded filename* and percent-encoded metadata, and serves them back', async () => {
    await storage.upload({
      key: 'e2e/encoded.pdf',
      body: Buffer.from('pdf'),
      contentType: 'application/pdf',
      contentDisposition: FILENAME_STAR,
      metadata: { owner: encodeURIComponent('José') },
    })

    const head = await storage.head('e2e/encoded.pdf')
    expect(head.contentDisposition).toBe(FILENAME_STAR)
    expect(decodeURIComponent(head.metadata.owner ?? '')).toBe('José')

    const { url } = await signed.getDownloadUrl({ key: 'e2e/encoded.pdf' })
    const response = await fetch(url)
    expect(response.headers.get('content-disposition')).toBe(FILENAME_STAR)
  })

  it('refuses a line break in a header-bound upload option, and stores nothing', async () => {
    const error: unknown = await storage
      .upload({
        key: 'e2e/injected.txt',
        body: Buffer.from('x'),
        contentType: 'text/plain',
        contentDisposition: 'attachment\r\nX-Injected: 1',
      })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    await expect(storage.head('e2e/injected.txt')).rejects.toMatchObject({
      code: 'STORAGE_OBJECT_NOT_FOUND',
    })
  })

  it('refuses a line break in a signed GET override before a URL is issued', async () => {
    const error: unknown = await signed
      .getDownloadUrl({
        key: 'e2e/encoded.pdf',
        responseContentDisposition: 'attachment\r\nX-Injected: 1',
      })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
  })

  it('shows what the provider does with a line break in a signed GET override it is given', async () => {
    // The URL is built straight with the SDK, bypassing the library's validation, to record how the
    // provider treats a reflected line break: it must not split the response.
    const url = await getSignedUrl(
      root,
      new GetObjectCommand({
        Bucket: minio.bucket,
        Key: 'e2e/encoded.pdf',
        ResponseContentDisposition: 'attachment\r\nX-Injected: 1',
      }),
      { expiresIn: 60 },
    )

    const response = await fetch(url)

    expect(response.headers.get('x-injected')).toBeNull()
  })
})
