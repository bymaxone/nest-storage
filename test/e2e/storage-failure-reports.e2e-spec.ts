/**
 * @fileoverview What an operator sees when a storage call fails during a rejected scan or a failed
 * multipart upload, against a live MinIO: a user denied `s3:DeleteObject` makes the scan cleanup
 * fail, a user denied `s3:AbortMultipartUpload` plus a failing `CompleteMultipartUpload` makes the
 * abort fail. The provider's real state is read back with the root credentials.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {
  BYMAX_STORAGE_S3_CLIENT,
  BymaxStorageModule,
  providerRecipes,
  StorageException,
  StorageService,
  type BymaxStorageModuleOptions,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'
import { createRestrictedUser, type RestrictedUser } from './fixtures/minio-restricted-user'

const MB = 1024 * 1024
const infected = { status: 'infected' as const, engine: 'e2e', threat: 'EICAR' }

/** The `details` and `message` of a `StorageException`'s response body. */
function bodyOf(error: unknown): { message: string | undefined; details: Record<string, unknown> } {
  const body = (error as StorageException).getResponse() as {
    error: { message?: string; details?: Record<string, unknown> }
  }
  return { message: body.error.message, details: body.error.details ?? {} }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((err: unknown) => err)
}

describe('Storage E2E — failure reports', () => {
  let minio: MinioHandle
  let root: S3Client
  let noDelete: RestrictedUser
  let noAbort: RestrictedUser
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    minio = await startMinio('failures')
    noDelete = await createRestrictedUser(minio, ['s3:DeleteObject'])
    noAbort = await createRestrictedUser(minio, ['s3:AbortMultipartUpload'])
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
    await minio.container.stop()
  })

  afterEach(async () => {
    await moduleRef?.close()
    moduleRef = undefined
    jest.restoreAllMocks()
  })

  /** A module for `user` (the root user when omitted) with the library's own client returned. */
  async function storageFor(
    user: { accessKeyId: string; secretAccessKey: string } | undefined,
    extra: Partial<BymaxStorageModuleOptions> = {},
  ): Promise<{ storage: StorageService; client: S3Client }> {
    const who = user ?? { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey }
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          ...providerRecipes.minio({ endpoint: minio.endpoint, bucket: minio.bucket, ...who }),
          maxAttempts: 1,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return {
      storage: moduleRef.get(StorageService),
      client: moduleRef.get<S3Client>(BYMAX_STORAGE_S3_CLIENT),
    }
  }

  const stored = (key: string): Promise<boolean> =>
    root.send(new HeadObjectCommand({ Bucket: minio.bucket, Key: key })).then(
      () => true,
      () => false,
    )

  const openUploads = async (key: string): Promise<string[]> => {
    const listed = await root.send(
      new ListMultipartUploadsCommand({ Bucket: minio.bucket, Prefix: key }),
    )
    return (listed.Uploads ?? []).map((u) => u.UploadId ?? '')
  }

  const postUploadScan = {
    mode: 'post-upload' as const,
    impl: { scan: () => Promise.resolve(infected) },
  }

  it('reports the cause and the stored key when the rejected object could not be deleted', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const { storage } = await storageFor(noDelete, {
      keyPrefix: 'tenant',
      scanner: postUploadScan,
    })

    const error = await rejection(
      storage.upload({ key: 'bad.bin', body: Buffer.from('x'), contentType: 'x/y' }),
    )

    expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
    const { details } = bodyOf(error)
    expect(details).toMatchObject({
      cleanup: 'failed',
      key: 'bad.bin',
      storedKey: 'tenant/bad.bin',
    })
    expect(details.cleanupError).toMatch(/^STORAGE_PROVIDER_ERROR: .*(access|denied)/i)
    expect(logged).toHaveBeenCalledWith(
      expect.stringMatching(/STORAGE_SCAN_CLEANUP_FAILED.*tenant\/bad\.bin/),
      expect.anything(),
    )
    // The provider's own state: the object the scanner rejected is still there.
    expect(await stored('tenant/bad.bin')).toBe(true)
  })

  it('removes the rejected object and reports no cleanup failure when the delete is allowed', async () => {
    const { storage } = await storageFor(undefined, {
      keyPrefix: 'tenant',
      scanner: postUploadScan,
    })

    const error = await rejection(
      storage.upload({ key: 'ok-bad.bin', body: Buffer.from('x'), contentType: 'x/y' }),
    )

    expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
    expect(bodyOf(error).details.cleanup).toBeUndefined()
    expect(await stored('tenant/ok-bad.bin')).toBe(false)
  })

  /** Makes the library's own client fail `CompleteMultipartUpload` the way a provider 500 would. */
  function failComplete(client: S3Client): void {
    client.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'CompleteMultipartUploadCommand') {
          throw Object.assign(new Error('InternalError'), {
            name: 'InternalError',
            $metadata: { httpStatusCode: 500 },
          })
        }
        return next(args)
      },
      { step: 'initialize', name: 'failComplete' },
    )
  }

  const bigStream = (): Readable => Readable.from([Buffer.alloc(6 * MB, 1)])

  it('says the abort did not complete, and the upload stays open, when the abort is denied', async () => {
    const { storage, client } = await storageFor(noAbort)
    failComplete(client)

    const error = await rejection(
      storage.upload({ key: 'denied-abort.bin', body: bigStream(), contentType: 'x/y' }),
    )

    expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
    const { message, details } = bodyOf(error)
    expect(message).toBe('Multipart upload failed and could not be aborted')
    expect(details).toMatchObject({ abort: 'failed', key: 'denied-abort.bin' })
    expect(typeof details.abortError).toBe('string')
    // The provider's own state: the upload is still open, as the report says.
    const open = await openUploads('denied-abort.bin')
    expect(open).toHaveLength(1)
    await root.send(
      new AbortMultipartUploadCommand({
        Bucket: minio.bucket,
        Key: 'denied-abort.bin',
        UploadId: open[0],
      }),
    )
  })

  it('keeps the aborted message, and leaves no open upload, when the abort works', async () => {
    const { storage, client } = await storageFor(undefined)
    failComplete(client)

    const error = await rejection(
      storage.upload({ key: 'allowed-abort.bin', body: bigStream(), contentType: 'x/y' }),
    )

    expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
    const { message, details } = bodyOf(error)
    expect(message).toBe('Multipart upload was aborted')
    expect(details).toMatchObject({ abort: 'completed' })
    expect(await openUploads('allowed-abort.bin')).toEqual([])
  })
})
