/**
 * @fileoverview The HTTP status a caller's layer receives for each condition of the object store,
 * against a live MinIO: hung, resetting, stopped, refusing the credentials, and healthy. An outage is
 * 503 whichever code carries it, a fault of the deployment is not, and a missing object stays 404.
 * @layer test/e2e
 */
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  StorageException,
  StorageService,
  type BymaxStorageModuleOptions,
} from '@bymax-one/nest-storage'
import { startMinio, type MinioHandle } from './fixtures/minio-container'
import { startFaultProxy, type FaultProxy } from './fixtures/fault-proxy'

const MB = 1024 * 1024

/** The code and HTTP status an operation rejects with. */
async function outcome(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  )
  if (!(error instanceof StorageException)) {
    throw new Error(`expected a StorageException, got ${String(error)}`)
  }
  return { code: error.code, status: error.getStatus() }
}

describe('Storage E2E — status of an unavailable store', () => {
  let minio: MinioHandle
  let proxy: FaultProxy
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    minio = await startMinio('status')
    proxy = await startFaultProxy({ host: '127.0.0.1', port: minio.container.getMappedPort(9000) })
  })

  afterAll(async () => {
    await proxy.close()
    await minio.container.stop().catch(() => undefined)
  })

  beforeEach(() => {
    proxy.setMode('pass')
  })

  afterEach(async () => {
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function open(extra: Partial<BymaxStorageModuleOptions> = {}): Promise<StorageService> {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: proxy.endpoint,
          region: 'us-east-1',
          bucket: minio.bucket,
          forcePathStyle: true,
          credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: minio.secretAccessKey },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
          requestTimeoutMs: 1000,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  it('answers 404 for a missing object while the store is healthy', async () => {
    const storage = await open()

    expect(await outcome(storage.head('missing.txt'))).toEqual({
      code: 'STORAGE_OBJECT_NOT_FOUND',
      status: 404,
    })
  })

  it('answers 503 STORAGE_TIMEOUT for a store that accepts the connection and never answers', async () => {
    const storage = await open()
    proxy.setMode('blackhole')

    expect(await outcome(storage.head('x.txt'))).toEqual({ code: 'STORAGE_TIMEOUT', status: 503 })
  })

  it('answers 503 for a store that resets every connection, on a read and on an upload', async () => {
    const storage = await open()
    proxy.setMode('reset')

    expect((await outcome(storage.head('x.txt'))).status).toBe(503)
    expect(
      (await outcome(storage.upload({ key: 'x.txt', body: Buffer.from('x'), contentType: 'text/plain' }))).status,
    ).toBe(503)
  })

  it('answers 503 for a multipart upload that the store cuts off, keeping its code', async () => {
    const storage = await open()
    proxy.setMode('reset')

    const body = Readable.from([Buffer.alloc(8 * MB, 1)])

    const result = await outcome(
      storage.upload({ key: 'big.bin', body, contentType: 'application/octet-stream', size: 8 * MB }),
    )

    expect(result.status).toBe(503)
    expect(['STORAGE_MULTIPART_ABORTED', 'STORAGE_TIMEOUT', 'STORAGE_PROVIDER_ERROR']).toContain(result.code)
  })

  it('answers 500 for credentials the store refuses, where the answer says so, and not 503', async () => {
    const storage = await open({
      credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: 'a-wrong-secret' },
    })

    const read = await outcome(storage.download({ key: 'x.txt' }))

    expect(read).toEqual({ code: 'STORAGE_PROVIDER_ERROR', status: 500 })
  })

  it('cannot tell refused credentials on a HEAD, which has no body, so head() keeps 502', async () => {
    const storage = await open({
      credentials: { accessKeyId: minio.accessKeyId, secretAccessKey: 'a-wrong-secret' },
    })

    expect(await outcome(storage.head('x.txt'))).toEqual({ code: 'STORAGE_PROVIDER_ERROR', status: 502 })
    expect(await outcome(storage.checkBucket())).toEqual({ code: 'STORAGE_BUCKET_ACCESS_DENIED', status: 403 })
  })

  it('answers 503 for a stopped store, with a connection that is refused', async () => {
    await minio.container.stop()
    const storage = await open({
      endpoint: minio.endpoint,
      requestTimeoutMs: 2000,
    })

    expect(await outcome(storage.head('x.txt'))).toEqual({ code: 'STORAGE_PROVIDER_ERROR', status: 503 })
  })
})
