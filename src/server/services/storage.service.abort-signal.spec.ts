/**
 * @fileoverview An `abortSignal` ends a call: an aborted signal makes no request, a signal that fires
 * mid-flight drops the request, a multipart upload is aborted on the provider with a signal of its
 * own (so the cleanup is not cancelled by the very signal that triggered it), and the library leaves
 * no listener on a signal a host reuses. Driven through the real SDK against a local S3 stand-in.
 * @layer server/services
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Readable } from 'node:stream'
import { getEventListeners } from 'node:events'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageException } from '../errors/storage-exception'
import { StorageService } from './storage.service'

const MIB = 1024 * 1024
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The text an operator or a log could read from an error: its message and its response body. */
function readable(error: unknown): string {
  return error instanceof StorageException
    ? `${error.message} ${JSON.stringify(error.getResponse())}`
    : String(error)
}

/** The `details` of a `StorageException`, or an empty object for any other error. */
function detailsOf(error: unknown): Record<string, unknown> {
  if (!(error instanceof StorageException)) return {}
  const body: unknown = error.getResponse()
  if (typeof body !== 'object' || body === null || !('error' in body)) return {}
  const inner: unknown = body.error
  if (typeof inner !== 'object' || inner === null || !('details' in inner)) return {}
  const details: unknown = inner.details
  return typeof details === 'object' && details !== null ? { ...details } : {}
}

/** A stream of `chunks` chunks of 1 MiB that ends on its own. */
function mibStream(chunks: number): Readable {
  let pulled = 0
  return new Readable({
    read() {
      if (pulled >= chunks) {
        this.push(null)
        return
      }
      pulled += 1
      this.push(Buffer.alloc(MIB, 7))
    },
  })
}

/**
 * Waits, for at most a second, until `signal` holds `baseline` abort listeners. The SDK takes one
 * for the length of a request and drops it when the connection closes, which after an error
 * response is a moment after the call rejects; the library adds none of its own.
 */
async function listenersAt(signal: AbortSignal, baseline: number): Promise<number> {
  for (let i = 0; i < 20 && getEventListeners(signal, 'abort').length !== baseline; i += 1) {
    await sleep(50)
  }
  return getEventListeners(signal, 'abort').length
}

describe('abortSignal', () => {
  let server: Server
  let port: number
  let calls: string[] = []
  let closed = 0
  /** Requests the client cut off before the stand-in answered them, by `METHOD search`. */
  let dropped: string[] = []
  /** Requests for which the stand-in never answers, picked by `METHOD search`. */
  let hang: (call: string) => boolean = () => false
  /** Requests the stand-in answers with a 500. */
  let fail: (call: string) => boolean = () => false
  /** How long the stand-in waits before answering a request, picked by `METHOD search`. */
  let delayMs: (call: string) => number = () => 0
  /** Answers a GET with two bytes of a five-byte body and then goes silent. */
  let stallBody = false
  let moduleRef: TestingModule | undefined
  const sockets = new Set<Socket>()

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stand-in')
      const call = `${req.method ?? ''} ${url.searchParams.has('uploads') ? 'uploads' : (url.search.split('&')[0] ?? '')}`
      req.resume()
      res.on('close', () => {
        if (!res.writableFinished) dropped.push(call)
      })
      req.on('end', () => {
        calls.push(call)
        if (hang(call)) return
        if (fail(call)) {
          res.statusCode = 500
          res.end()
          return
        }
        setTimeout(() => {
          respond(req.method ?? '', url, res)
        }, delayMs(call))
      })
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => {
        sockets.delete(socket)
        closed += 1
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0
  })

  /** A minimal S3: enough of the protocol for the calls under test. */
  function respond(method: string, url: URL, res: ServerResponse): void {
    const isBucketOnly = /^\/b\/?$/.test(url.pathname)
    if (method === 'HEAD') {
      res.setHeader('content-length', '5')
      res.setHeader('etag', '"e"')
      res.end()
    } else if (method === 'GET' && isBucketOnly) {
      res.setHeader('content-type', 'application/xml')
      res.end('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')
    } else if (method === 'GET' && stallBody) {
      res.setHeader('content-length', '5')
      res.write('he')
    } else if (method === 'GET') {
      res.setHeader('content-length', '5')
      res.end('hello')
    } else if (method === 'DELETE') {
      res.statusCode = 204
      res.end()
    } else if (method === 'POST' && url.searchParams.has('uploads')) {
      res.setHeader('content-type', 'application/xml')
      res.end('<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>')
    } else if (method === 'POST') {
      res.setHeader('content-type', 'application/xml')
      res.end('<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>')
    } else {
      res.setHeader('etag', '"p"')
      res.end()
    }
  }

  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  beforeEach(() => {
    calls = []
    closed = 0
    dropped = []
    hang = () => false
    fail = () => false
    delayMs = () => 0
    stallBody = false
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await moduleRef?.close()
    moduleRef = undefined
  })

  async function storage(): Promise<StorageService> {
    return storageWith({})
  }

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

  const operations: [string, (s: StorageService, abortSignal: AbortSignal) => Promise<unknown>][] = [
    ['head', (s, abortSignal) => s.head('k', { abortSignal })],
    ['exists', (s, abortSignal) => s.exists('k', { abortSignal })],
    ['download', (s, abortSignal) => s.download({ key: 'k', abortSignal })],
    ['downloadBuffer', (s, abortSignal) => s.downloadBuffer({ key: 'k', abortSignal })],
    ['list', (s, abortSignal) => s.list({ abortSignal })],
    ['delete', (s, abortSignal) => s.delete('k', { abortSignal })],
    ['checkBucket', (s, abortSignal) => s.checkBucket({ abortSignal })],
    ['upload of a buffer', (s, abortSignal) => s.upload({ key: 'k', body: Buffer.from('x'), contentType: 'x/y', abortSignal })],
    ['upload of a stream', (s, abortSignal) => s.upload({ key: 'k', body: mibStream(8), contentType: 'x/y', abortSignal })],
  ]

  it.each(operations)('%s with a signal that is already aborted makes no request and rejects STORAGE_REQUEST_ABORTED', async (_name, run) => {
    const service = await storage()

    const error: unknown = await run(service, AbortSignal.abort()).catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED', status: 499 })
    expect(detailsOf(error)).toMatchObject({ reason: 'AbortError' })
    expect(calls).toEqual([])
  })

  it('names the key, the bucket and the operation of an upload refused before any request', async () => {
    const service = await storage()

    const error: unknown = await service
      .upload({ key: 'k', body: Buffer.from('x'), contentType: 'x/y', abortSignal: AbortSignal.abort() })
      .catch((err: unknown) => err)

    expect(detailsOf(error)).toMatchObject({ key: 'k', bucket: 'b', op: 'upload' })
  })

  it('names the reason by its type and never repeats its message', async () => {
    // A host tells its own timeout from a client disconnect by the name; the message is its business.
    const service = await storage()
    const signal = AbortSignal.abort(new DOMException('took too long for SECRETEXAMPLE', 'TimeoutError'))

    const error: unknown = await service.head('k', { abortSignal: signal }).catch((err: unknown) => err)

    expect(detailsOf(error)).toMatchObject({ reason: 'TimeoutError' })
    expect(readable(error)).not.toContain('SECRETEXAMPLE')
  })

  it.each([['a string', 'bye'], ['an object without a name', { code: 1 }], ['null', null]])(
    'names a reason that is %s AbortError, since it has no name of its own',
    async (_label, reason) => {
      const service = await storage()

      const error: unknown = await service
        .head('k', { abortSignal: AbortSignal.abort(reason) })
        .catch((err: unknown) => err)

      expect(detailsOf(error)).toMatchObject({ reason: 'AbortError' })
    },
  )

  it('drops an in-flight request when the signal fires, and the connection closes', async () => {
    hang = (call) => call.startsWith('HEAD')
    const service = await storage()
    const controller = new AbortController()
    const started = Date.now()
    const pending = service.head('k', { abortSignal: controller.signal }).catch((err: unknown) => err)
    await sleep(150)
    controller.abort()

    const error = await pending

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(Date.now() - started).toBeLessThan(2000)
    await sleep(100)
    expect(closed).toBeGreaterThanOrEqual(1)
  })

  it('exists rejects an aborted call instead of answering false', async () => {
    hang = (call) => call.startsWith('HEAD')
    const service = await storage()
    const controller = new AbortController()
    const pending = service.exists('k', { abortSignal: controller.signal }).catch((err: unknown) => err)
    await sleep(100)
    controller.abort()

    expect(await pending).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
  })

  it('aborts a multipart upload on the provider after the signal fires, with a signal of its own', async () => {
    // The part is held open by the stand-in; the cleanup DELETE must still reach it, which it cannot
    // if the cleanup were sent with the aborted signal.
    hang = (call) => call.startsWith('PUT ?partNumber')
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    const service = await storage()
    const controller = new AbortController()
    const baseline = getEventListeners(controller.signal, 'abort').length
    const body = mibStream(40)
    const pending = service
      .upload({ key: 'k', body, contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)
    for (let i = 0; i < 100 && !calls.some((c) => c.startsWith('PUT ?partNumber')); i += 1) await sleep(50)
    controller.abort()

    const error = await pending

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(detailsOf(error)).toMatchObject({
      reason: 'AbortError',
      abort: 'completed',
      key: 'k',
      bucket: 'b',
      op: 'upload-multipart',
    })
    expect(calls).toContain('DELETE ?uploadId=u1')
    expect(calls).not.toContain('POST ?uploadId=u1')
    // The part request that was held open is dropped, not left for the provider to time out.
    await sleep(150)
    expect(dropped).toContain('PUT ?partNumber=1')
    expect(timeout).toHaveBeenCalled()
    expect(body.destroyed).toBe(true)
    expect(await listenersAt(controller.signal, baseline)).toBe(baseline)
  })

  it('still aborts the upload on the provider when the signal fires while CreateMultipartUpload is in flight', async () => {
    // The provider creates the upload and answers late; the id arrives after the caller gave up.
    delayMs = (call) => (call === 'POST uploads' ? 400 : 0)
    const service = await storage()
    const controller = new AbortController()
    const pending = service
      .upload({ key: 'k', body: mibStream(40), contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)
    for (let i = 0; i < 40 && !calls.includes('POST uploads'); i += 1) await sleep(25)
    controller.abort()

    const error = await pending

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(detailsOf(error)).toMatchObject({ abort: 'completed' })
    expect(calls).toContain('DELETE ?uploadId=u1')
    expect(calls.some((call) => call.startsWith('PUT ?partNumber'))).toBe(false)
  })

  it('reports a real failure as itself when the signal only fires during its cleanup', async () => {
    // The stream passes maxSizeBytes after one part; the signal fires while the cleanup DELETE is held.
    delayMs = (call) => (call.startsWith('DELETE') ? 400 : 0)
    const service = await storageWith({ validation: { maxSizeBytes: 6 * MIB } })
    const controller = new AbortController()
    const pending = service
      .upload({ key: 'k', body: mibStream(40), contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)
    for (let i = 0; i < 200 && !calls.some((c) => c.startsWith('DELETE')); i += 1) await sleep(25)
    controller.abort()

    const error = await pending

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
  })

  /** A stream that never delivers a byte and never ends. */
  function silentStream(): Readable {
    return new Readable({ read() {} })
  }

  it.each([
    [
      'the pre-upload scan is buffering a silent stream',
      {
        validation: { maxSizeBytes: 10 * MIB },
        scanner: { impl: { scan: () => Promise.resolve({ status: 'clean' as const, engine: 'e' }) }, mode: 'pre-upload' as const },
      },
    ],
    [
      'a custom validator is reading the head of a silent stream',
      {
        validation: {
          customValidators: [
            {
              name: 'peek',
              validate: async (context: { readBytes?: (maxBytes: number) => Promise<Buffer> }) => {
                await context.readBytes?.(16)
                return { ok: true as const }
              },
            },
          ],
        },
      },
    ],
  ])('ends an upload and releases its stream when the signal fires while %s', async (_label, extra) => {
    // Preparing the body happens before any request, so no SDK call carries the signal here.
    const service = await storageWith(extra)
    const controller = new AbortController()
    const body = silentStream()
    const started = Date.now()
    const pending = service
      .upload({ key: 'k', body, contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)
    await sleep(150)
    controller.abort()

    const error = await Promise.race([pending, sleep(3000).then(() => 'STILL_PENDING')])

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(body.destroyed).toBe(true)
    expect(calls).toEqual([])
  })

  it('ends an upload whose validator aborts the signal itself before waiting on a silent stream', async () => {
    // The abort happens inside the validator, before the library starts watching the signal.
    const controller = new AbortController()
    const service = await storageWith({
      validation: {
        customValidators: [
          {
            name: 'abort-then-peek',
            validate: async (context: { readBytes?: (maxBytes: number) => Promise<Buffer> }) => {
              controller.abort()
              await context.readBytes?.(16)
              return { ok: true as const }
            },
          },
        ],
      },
    })
    const body = silentStream()
    const pending = service
      .upload({ key: 'k', body, contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)

    const error = await Promise.race([pending, sleep(3000).then(() => 'STILL_PENDING')])

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(detailsOf(error)).toMatchObject({ key: 'k', bucket: 'b', op: 'upload' })
    expect(body.destroyed).toBe(true)
    expect(calls).toEqual([])
  })

  it('ends a multipart upload at once when the signal fires while the body is silent between parts', async () => {
    // No request is in flight then, so only the upload's own abort can end the wait; without it the
    // call would last until the idle guard fires.
    const service = await storageWith({ uploadIdleTimeoutMs: 20_000 })
    const controller = new AbortController()
    let pulled = 0
    const body = new Readable({
      read() {
        if (pulled < 12) {
          pulled += 1
          this.push(Buffer.alloc(MIB, 7))
        }
      },
    })
    const pending = service
      .upload({ key: 'k', body, contentType: 'x/y', abortSignal: controller.signal })
      .catch((err: unknown) => err)
    for (let i = 0; i < 100 && pulled < 12; i += 1) await sleep(25)
    await sleep(300)
    controller.abort()

    const error = await Promise.race([pending, sleep(3000).then(() => 'STILL_PENDING')])

    expect(error).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(body.destroyed).toBe(true)
  })

  it('leaves no listener on a signal reused across a completed, a failed and an aborted call', async () => {
    const service = await storage()
    const controller = new AbortController()
    const baseline = getEventListeners(controller.signal, 'abort').length

    await service.head('k', { abortSignal: controller.signal })
    expect(await listenersAt(controller.signal, baseline)).toBe(baseline)

    fail = (call) => call.startsWith('HEAD')
    await service.head('k', { abortSignal: controller.signal }).catch(() => undefined)
    expect(await listenersAt(controller.signal, baseline)).toBe(baseline)

    fail = () => false
    await service.upload({ key: 'k', body: mibStream(6), contentType: 'x/y', abortSignal: controller.signal })
    expect(await listenersAt(controller.signal, baseline)).toBe(baseline)

    hang = (call) => call.startsWith('HEAD')
    const pending = service.head('k', { abortSignal: controller.signal }).catch(() => undefined)
    await sleep(100)
    controller.abort()
    await pending
    expect(await listenersAt(controller.signal, baseline)).toBe(baseline)
  })

  it('ends a download body that is being read when the signal fires, with the typed error and a released connection', async () => {
    stallBody = true
    const service = await storage()
    const controller = new AbortController()
    const { stream } = await service.download({ key: 'k', abortSignal: controller.signal })
    const reading = (async (): Promise<unknown> => {
      try {
        let bytes = 0
        for await (const chunk of stream) {
          bytes += chunk.length
        }
        return bytes
      } catch (err) {
        return err
      }
    })()
    await sleep(150)
    controller.abort()

    const outcome = await reading

    expect(outcome).toMatchObject({ code: 'STORAGE_REQUEST_ABORTED' })
    expect(detailsOf(outcome)).toMatchObject({ reason: 'AbortError', key: 'k', bucket: 'b' })
    await sleep(100)
    expect(closed).toBeGreaterThanOrEqual(1)
  })
})
