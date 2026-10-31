/**
 * @fileoverview `requestTimeoutMs` against a real socket: a local HTTP server
 * that accepts the request and never answers. A mocked handler would only prove the
 * option was forwarded; this proves the request actually fails, and as
 * `STORAGE_TIMEOUT`.
 * @layer server/providers
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageService } from '../services/storage.service'

describe('requestTimeoutMs', () => {
  let server: Server
  let port: number
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    // Accepts connections and reads the request, but never writes a response.
    server = createServer(() => undefined)
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
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function storageWith(requestTimeoutMs: number): Promise<StorageService> {
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
          // One attempt, so the elapsed time is one timeout rather than three plus backoff.
          maxAttempts: 1,
          requestTimeoutMs,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  it('fails a request the server never answers with STORAGE_TIMEOUT, within about the configured time', async () => {
    const storage = await storageWith(300)
    const started = Date.now()

    const error: unknown = await storage.head('never-answered.txt').catch((err: unknown) => err)

    const elapsed = Date.now() - started
    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT', status: 504 })
    // Not before the configured time, and well before the 30 s default.
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(5000)
  })

  it('honours a different configured value', async () => {
    const storage = await storageWith(800)
    const started = Date.now()

    const error: unknown = await storage.head('never-answered.txt').catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(750)
  })
})
