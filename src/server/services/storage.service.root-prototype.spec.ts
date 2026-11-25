/**
 * @fileoverview The refusal raised while the root object prototype carries a planted key reaches
 * the caller of the public service with its own code, and `exists()` does not turn it into `false`.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageService } from './storage.service'

describe('a planted root prototype key reaches the caller as the refusal', () => {
  let server: Server
  let port: number
  let requests = 0
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests += 1
      req.resume()
      res.setHeader('Content-Length', '0')
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  afterEach(async () => {
    Reflect.deleteProperty(Object.prototype, 'ACL')
    await moduleRef?.close()
    moduleRef = undefined
    requests = 0
  })

  async function setup(): Promise<StorageService> {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: `http://127.0.0.1:${String(port)}`,
          region: 'us-east-1',
          bucket: 'b',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  function plant(): void {
    Object.defineProperty(Object.prototype, 'ACL', {
      value: 'public-read',
      configurable: true,
      enumerable: false,
      writable: true,
    })
  }

  it('keeps the validation code on head() and sends nothing', async () => {
    // The mapper must not rewrite the refusal into a provider error.
    const storage = await setup()
    plant()
    await expect(storage.head('k')).rejects.toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    expect(requests).toBe(0)
  })

  it('throws from exists() instead of answering false', async () => {
    // A refusal is not "the object is missing"; answering false would hide it.
    const storage = await setup()
    plant()
    await expect(storage.exists('k')).rejects.toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    expect(requests).toBe(0)
  })

  it('rejects deleteMany() instead of listing every key as failed', async () => {
    // A batch delete reports per-key failures; the refusal is not one of them.
    const storage = await setup()
    plant()
    await expect(storage.deleteMany(['a', 'b'])).rejects.toMatchObject({
      code: 'STORAGE_VALIDATION_FAILED',
    })
    expect(requests).toBe(0)
  })
})
