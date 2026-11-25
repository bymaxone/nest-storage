/**
 * @fileoverview What a caller catches when a download body fails after its headers arrived: a reset
 * connection or a cancelled request. With the idle guard on, and for `downloadBuffer()` in both modes,
 * the failure is a `StorageException`, never the SDK's raw error. With the guard off, `download()` hands
 * back the SDK's own body and its errors stay raw, as the README documents. Driven through the real SDK
 * against a local server that sends the headers and part of the body, then resets or goes silent.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageException } from '../errors/storage-exception'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageService } from './storage.service'

const BODY_BYTES = 1_000_000
const SENT_BYTES = 100_000

/** The `details` a `StorageException` carries in its response body. */
function detailsOf(error: unknown): Record<string, unknown> {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details ?? {}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits until `condition` holds; gives up before the test limit, so the failure names what never happened. */
async function until(condition: () => boolean, description: string): Promise<void> {
  const giveUpAt = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > giveUpAt) throw new Error(`never happened: ${description}`)
    await sleep(10)
  }
}

// A call that is never ended by the failure under test waits for this limit, and ends the test with it.
jest.setTimeout(15_000)

describe('a download body that fails after its headers', () => {
  let server: Server
  let port: number
  /** What the stand-in does after it has sent part of the body. */
  let afterPartialBody: 'reset' | 'silence' = 'reset'
  let bodyStarted = false
  /** Set when the test is over, so a poll or a timer it started ends with it and cannot fire in a later test. */
  let testOver = false
  let abortTimer: NodeJS.Timeout | undefined
  let moduleRef: TestingModule | undefined
  const sockets = new Set<Socket>()

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, {
          'content-length': String(BODY_BYTES),
          'content-type': 'application/octet-stream',
        })
        res.write(Buffer.alloc(SENT_BYTES, 1), () => {
          bodyStarted = true
          if (afterPartialBody === 'reset') {
            setTimeout(() => {
              res.socket?.destroy()
            }, 30)
          }
        })
      })
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => {
        sockets.delete(socket)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  beforeEach(() => {
    afterPartialBody = 'reset'
    bodyStarted = false
    testOver = false
  })

  afterEach(async () => {
    testOver = true
    clearTimeout(abortTimer)
    jest.restoreAllMocks()
    await moduleRef?.close()
    moduleRef = undefined
  })

  /** A service whose only way to end a silent body is the caller's signal: the timeout is far away. */
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
          requestTimeoutMs: 120_000,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  /** Reads a stream to its end or to its error. */
  async function drain(stream: AsyncIterable<Buffer | string>): Promise<unknown> {
    let bytes = 0
    try {
      for await (const chunk of stream) bytes += chunk.length
      return bytes
    } catch (err) {
      return err
    }
  }

  /** Aborts once the body has started, so the signal and not the timeout is what ends the call. */
  function abortWhenStarted(): AbortSignal {
    const controller = new AbortController()
    until(() => bodyStarted || testOver, 'the first bytes of the body were sent')
      .then(() => {
        if (testOver) return
        abortTimer = setTimeout(() => {
          controller.abort()
        }, 50)
      })
      .catch(() => undefined)
    return controller.signal
  }

  /** The operation a mapped failure names: the guard maps the body it wraps, `downloadBuffer()` the one it reads. */
  const guards: [string, Partial<BymaxStorageModuleOptions>, string][] = [
    ['the idle guard on', {}, 'download'],
    ['the idle guard off', { bodyIdleTimeoutMs: 0 }, 'downloadBuffer'],
  ]

  describe.each(guards)('with %s', (_guard, options, op) => {
    it('rejects downloadBuffer() with a provider error when the connection is reset mid-body', async () => {
      const storage = await storageWith(options)

      const error: unknown = await storage.downloadBuffer({ key: 'k' }).catch((err: unknown) => err)

      expect(error).toBeInstanceOf(StorageException)
      expect(error).toMatchObject({ code: 'STORAGE_PROVIDER_ERROR', status: 503 })
      expect(detailsOf(error)).toMatchObject({ reason: 'unreachable', key: 'k', op })
    })

    it('rejects downloadBuffer() with the typed abort when the caller cancels mid-body', async () => {
      afterPartialBody = 'silence'
      const storage = await storageWith(options)

      const error: unknown = await storage
        .downloadBuffer({ key: 'k', abortSignal: abortWhenStarted() })
        .catch((err: unknown) => err)

      expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
      expect(detailsOf(error)).toMatchObject({ reason: 'AbortError', key: 'k' })
    })
  })

  describe('with the idle guard on', () => {
    it('ends the download stream with a provider error when the connection is reset mid-body', async () => {
      const storage = await storageWith({})
      const { stream } = await storage.download({ key: 'k' })

      const outcome = await drain(stream)

      expect(outcome).toBeInstanceOf(StorageException)
      expect(outcome).toMatchObject({ code: 'STORAGE_PROVIDER_ERROR', status: 503 })
      expect(detailsOf(outcome)).toMatchObject({ reason: 'unreachable', key: 'k' })
    })

    it('ends the download stream with the typed abort when the caller cancels mid-body', async () => {
      afterPartialBody = 'silence'
      const storage = await storageWith({})
      const { stream } = await storage.download({ key: 'k', abortSignal: abortWhenStarted() })

      const outcome = await drain(stream)

      expect(outcome).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    })
  })

  describe('with the idle guard off, where download() hands back the SDK body', () => {
    // The README documents this: a stream the library does not wrap errors with the SDK's own error.
    // These cases pin it, so that it is not changed by accident.
    it('leaves a mid-body reset as the SDK error', async () => {
      const storage = await storageWith({ bodyIdleTimeoutMs: 0 })
      const { stream } = await storage.download({ key: 'k' })

      const outcome = await drain(stream)

      expect(outcome).not.toBeInstanceOf(StorageException)
      expect(outcome).toMatchObject({ code: 'ECONNRESET', message: 'aborted' })
    })

    it('leaves a mid-body cancellation as the SDK error, whichever it is', async () => {
      afterPartialBody = 'silence'
      const signal = abortWhenStarted()
      const storage = await storageWith({ bodyIdleTimeoutMs: 0 })
      const { stream } = await storage.download({ key: 'k', abortSignal: signal })

      const outcome = await drain(stream)

      expect(signal.aborted).toBe(true)
      expect(outcome).not.toBeInstanceOf(StorageException)
      expect(typeof (outcome as { message?: unknown }).message).toBe('string')
    })
  })

  it('tells a client nothing of the driver, and logs what it said once', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const storage = await storageWith({})

    const error = (await storage
      .downloadBuffer({ key: 'k' })
      .catch((err: unknown) => err)) as StorageException

    const clientText = JSON.stringify(error.getResponse())
    expect(clientText).not.toMatch(/127\.0\.0\.1|ECONN|aborted|socket/i)
    expect(error.cause).toBeUndefined()
    expect(JSON.stringify(error)).not.toMatch(/ECONN|aborted/i)
    expect(warn).toHaveBeenCalledTimes(1)
    const entry = warn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(entry).toMatchObject({
      event: 'STORAGE_PROVIDER_CALL_FAILED',
      message: 'Provider call failed',
      operation: 'download',
    })
    expect((entry.err as Error).message).toMatch(/aborted/)
    const outside = JSON.stringify({ ...entry, err: undefined })
    expect(outside).not.toMatch(/ECONN|aborted|socket/i)
  })

  it.each(guards)(
    'logs nothing for a request the caller cancelled, with %s',
    async (_guard, options) => {
      afterPartialBody = 'silence'
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const storage = await storageWith(options)

      await storage
        .downloadBuffer({ key: 'k', abortSignal: abortWhenStarted() })
        .catch(() => undefined)

      expect(warn).not.toHaveBeenCalled()
    },
  )
})
