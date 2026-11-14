/**
 * @fileoverview A download body that stops delivering bytes is cut off, and one that is merely
 * not being read is not. Driven through the real SDK against a local server that answers with
 * headers and then either stalls or sends a body the consumer reads at its own pace.
 * @layer server/services
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { StorageException } from '../errors/storage-exception'
import { StorageService } from './storage.service'
import { destroyStream } from '../utils/stream-utils'

const MIB = 1024 * 1024
const IDLE_MS = 250

/** The `details` a `StorageException` carries in its response body. */
function detailsOf(error: unknown): Record<string, unknown> {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details ?? {}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('download body idle timeout', () => {
  let server: Server
  let port: number
  let mode: 'stall' | 'healthy' = 'stall'
  let closedSockets = 0
  let moduleRef: TestingModule | undefined
  const sockets = new Set<Socket>()
  const responses = new Set<ServerResponse>()

  beforeAll(async () => {
    server = createServer((_req, res) => {
      responses.add(res)
      if (mode === 'stall') {
        res.writeHead(200, { 'content-length': String(4 * MIB), 'content-type': 'application/octet-stream' })
        res.write(Buffer.alloc(1024, 1))
        return
      }
      res.writeHead(200, { 'content-length': String(4 * MIB), 'content-type': 'application/octet-stream' })
      res.end(Buffer.alloc(4 * MIB, 2))
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => {
        sockets.delete(socket)
        closedSockets += 1
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  beforeEach(() => {
    mode = 'stall'
    closedSockets = 0
  })

  afterEach(async () => {
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function storageWith(extra: Partial<BymaxStorageModuleOptions>): Promise<StorageService> {
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
          requestTimeoutMs: 5000,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  /** Reads a stream to its end or its error. */
  async function drain(stream: AsyncIterable<Buffer | string>): Promise<unknown> {
    let bytes = 0
    try {
      for await (const chunk of stream) {
        bytes += chunk.length
      }
      return bytes
    } catch (err) {
      return err
    }
  }

  it('fails a stalled body with STORAGE_TIMEOUT phase body-idle within the limit, and releases the socket', async () => {
    // The request timeout covers only the headers; a body that stops mid-way must not hold the caller forever.
    const storage = await storageWith({ bodyIdleTimeoutMs: IDLE_MS })
    const { stream } = await storage.download({ key: 'k' })
    const started = Date.now()

    const outcome = await drain(stream)

    expect(outcome).toMatchObject({ code: 'STORAGE_TIMEOUT', status: 503 })
    expect(detailsOf(outcome)).toMatchObject({ phase: 'body-idle', idleMs: IDLE_MS, key: 'k', bucket: 'b' })
    expect(Date.now() - started).toBeLessThan(IDLE_MS * 4)
    await sleep(200)
    expect(closedSockets).toBeGreaterThanOrEqual(1)
  })

  it('does not cut a healthy body whose consumer is slow', async () => {
    // Backpressure pauses the reader; the clock runs only while the consumer is waiting for data.
    mode = 'healthy'
    const storage = await storageWith({ bodyIdleTimeoutMs: IDLE_MS })
    const { stream } = await storage.download({ key: 'k' })
    const iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]()

    let bytes = 0
    for (;;) {
      const step = await iterator.next()
      if (step.done === true) break
      bytes += step.value.length
      await sleep(IDLE_MS * 2)
      if (bytes >= 3 * 64 * 1024) break
    }
    // Finish quickly once the slow phase is over.
    const rest = await drain({ [Symbol.asyncIterator]: () => iterator })

    expect(typeof rest).toBe('number')
    expect(bytes + (rest as number)).toBe(4 * MIB)
  })

  it('leaves a stalled body alone when bodyIdleTimeoutMs is 0', async () => {
    // 0 turns the guard off, as it does for uploadIdleTimeoutMs.
    const storage = await storageWith({ bodyIdleTimeoutMs: 0 })
    const { stream } = await storage.download({ key: 'k' })

    const outcome = await Promise.race([drain(stream), sleep(IDLE_MS * 4).then(() => 'STILL_WAITING')])

    expect(outcome).toBe('STILL_WAITING')
    destroyStream(stream)
  })

  it('takes requestTimeoutMs as the default limit', async () => {
    // With no bodyIdleTimeoutMs the idle limit follows requestTimeoutMs.
    const storage = await storageWith({ requestTimeoutMs: 300 })
    const { stream } = await storage.download({ key: 'k' })
    const started = Date.now()

    const outcome = await drain(stream)

    expect(outcome).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(detailsOf(outcome)).toMatchObject({ phase: 'body-idle', idleMs: 300 })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('downloadBuffer rejects a stalled body with STORAGE_TIMEOUT instead of waiting', async () => {
    // The buffered read goes through the same guard.
    const storage = await storageWith({ bodyIdleTimeoutMs: IDLE_MS })

    const error: unknown = await storage.downloadBuffer({ key: 'k' }).catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
    expect(detailsOf(error)).toMatchObject({ phase: 'body-idle' })
  })

  it('downloadBuffer returns a healthy body whole', async () => {
    // The guard must not alter a body that keeps arriving.
    mode = 'healthy'
    const storage = await storageWith({ bodyIdleTimeoutMs: IDLE_MS })

    const { buffer } = await storage.downloadBuffer({ key: 'k' })

    expect(buffer.length).toBe(4 * MIB)
    expect(buffer[0]).toBe(2)
  })
})
