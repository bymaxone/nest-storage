/**
 * @fileoverview How the library behaves when the object store is hung, resetting connections,
 * stalls in the middle of a download body, or is stopped altogether, against a live MinIO behind a
 * fault-injecting proxy. The hung, resetting and stopped store cases assert a bound on time and, for
 * the first two, on attempts, plus that no credential or signed URL reaches an error or a log line;
 * the stalled body case asserts a timely STORAGE_TIMEOUT and that the connection is closed.
 * @layer test/e2e
 */
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import {
  BymaxStorageModule,
  StorageException,
  StorageService,
  SignedUrlService,
  type BymaxStorageModuleOptions,
} from '@bymax-one/nest-storage'
import { destroyStream } from '../../src/server/utils/stream-utils'
import { startMinio, type MinioHandle } from './fixtures/minio-container'
import { startFaultProxy, type FaultProxy } from './fixtures/fault-proxy'

const MB = 1024 * 1024
const REQUEST_TIMEOUT_MS = 1000
const MAX_ATTEMPTS = 3

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((err: unknown) => err)
}

describe('Storage E2E — store failure', () => {
  let minio: MinioHandle
  let proxy: FaultProxy
  let moduleRef: TestingModule | undefined
  let logged: string[]

  beforeAll(async () => {
    minio = await startMinio('faults')
    proxy = await startFaultProxy({
      host: '127.0.0.1',
      port: minio.container.getMappedPort(9000),
    })
  })

  afterAll(async () => {
    await proxy.close()
    await minio.container.stop().catch(() => undefined)
  })

  beforeEach(() => {
    logged = []
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '))
      })
    }
    proxy.setMode('pass')
    proxy.resetCount()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function open(extra: Partial<BymaxStorageModuleOptions> = {}): Promise<{
    storage: StorageService
    signed: SignedUrlService
  }> {
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
          maxAttempts: MAX_ATTEMPTS,
          requestTimeoutMs: REQUEST_TIMEOUT_MS,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return { storage: moduleRef.get(StorageService), signed: moduleRef.get(SignedUrlService) }
  }

  /** Nothing secret in the error, in what the caller would log, or in what the library logged. */
  async function expectNoSecrets(error: unknown, signedUrl?: string): Promise<void> {
    const text = [
      JSON.stringify((error as StorageException).getResponse()),
      (error as Error).message,
      String((error as Error).stack),
      ...logged,
    ].join('\n')
    expect(text).not.toContain(minio.secretAccessKey)
    expect(text).not.toMatch(/X-Amz-Signature/i)
    expect(text).not.toMatch(/X-Amz-Credential/i)
    if (signedUrl !== undefined) {
      expect(text).not.toContain(signedUrl)
    }
    await Promise.resolve()
  }

  it('a hung store ends in STORAGE_TIMEOUT within requestTimeoutMs x maxAttempts, no more attempts than allowed', async () => {
    const { storage, signed } = await open()
    const url = (await signed.getDownloadUrl({ key: 'x.txt' })).url
    proxy.setMode('blackhole')
    const started = Date.now()

    const error = await rejection(storage.head('x.txt'))

    const elapsed = Date.now() - started
    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(proxy.connections()).toBeLessThanOrEqual(MAX_ATTEMPTS)
    expect(proxy.connections()).toBeGreaterThanOrEqual(1)
    // Three attempts plus the SDK's backoff; never an open-ended wait.
    expect(elapsed).toBeLessThan(REQUEST_TIMEOUT_MS * MAX_ATTEMPTS + 4000)
    await expectNoSecrets(error, url)
  })

  it('a store that resets every connection fails closed within maxAttempts, with no secret in the error', async () => {
    const { storage } = await open()
    proxy.setMode('reset')
    const started = Date.now()

    const error = await rejection(storage.head('x.txt'))

    expect(error).toBeInstanceOf(StorageException)
    expect(proxy.connections()).toBeLessThanOrEqual(MAX_ATTEMPTS)
    expect(Date.now() - started).toBeLessThan(REQUEST_TIMEOUT_MS * MAX_ATTEMPTS + 4000)
    await expectNoSecrets(error)
  })

  it('recovers once the store is back, without a restart (a flapping provider)', async () => {
    const { storage } = await open({ maxAttempts: 1 })
    await storage.upload({ key: 'flap.txt', body: Buffer.from('ok'), contentType: 'text/plain' })
    proxy.setMode('reset')
    await expect(storage.head('flap.txt')).rejects.toBeInstanceOf(StorageException)
    proxy.setMode('pass')
    await expect(storage.head('flap.txt')).resolves.toMatchObject({ size: 2 })
  })

  it('a download body that stalls midway errors in bounded time and releases the socket', async () => {
    const { storage } = await open({ maxAttempts: 1 })
    await storage.upload({
      key: 'stall.bin',
      body: Buffer.alloc(4 * MB, 1),
      contentType: 'application/octet-stream',
    })
    proxy.setMode('stall-response', { stallAfterBytes: 64 * 1024 })
    const { stream } = await storage.download({ key: 'stall.bin' })

    const timer: { id?: NodeJS.Timeout } = {}
    const outcome = await Promise.race([
      (async (): Promise<string> => {
        try {
          for await (const chunk of stream) {
            void chunk
          }
          return 'ended'
        } catch (err) {
          return (err as { code?: string }).code ?? 'error'
        }
      })(),
      new Promise<string>((resolve) => {
        timer.id = setTimeout(() => {
          resolve('STILL_HANGING')
        }, 8000)
      }),
    ]).finally(() => {
      clearTimeout(timer.id)
    })

    destroyStream(stream)
    expect(outcome).toBe('STORAGE_TIMEOUT')
    // The guard destroys the body, which closes the connection the proxy sees.
    const deadline = Date.now() + 3000
    while (proxy.openConnections() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    expect(proxy.openConnections()).toBe(0)
  })

  it('a stopped store (container down) fails within the bound with no credential or signed URL in the error or logs', async () => {
    const { storage } = await open()
    await minio.container.stop()
    const started = Date.now()

    const error = await rejection(storage.head('x.txt'))

    expect(error).toBeInstanceOf(StorageException)
    expect(Date.now() - started).toBeLessThan(REQUEST_TIMEOUT_MS * MAX_ATTEMPTS + 4000)
    await expectNoSecrets(error)
  })
})
