/**
 * @fileoverview The library takes ownership of a `Readable` body on `upload()`, as
 * `stream.pipeline` does: after any rejection the source stream is destroyed, which
 * releases the file handle or socket behind it. Every rejection path is driven here,
 * against a local server for the provider failures.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { IFileScanner } from '../interfaces/file-scanner.interface'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageService } from './storage.service'

/** The request timeout of the cases whose server never answers; long enough for one round trip. */
const STALL_TIMEOUT_MS = 200

/** A readable that never ends on its own, so only a destroy can close it. */
function openStream(bytes = 64): Readable {
  const source = new Readable({ read() {} })
  source.push(Buffer.alloc(bytes, 1))
  return source
}

// The SDK wraps a stream body in its own Readable under its default checksum setting
// (WHEN_SUPPORTED, what an AWS S3 deployment runs) and not under WHEN_REQUIRED (what the
// non-AWS provider recipes set), so every case runs under both.
/** A finished stream that only the library can destroy (autoDestroy is off). */
function endedStream(bytes = 64): Readable {
  const source = new Readable({ autoDestroy: false, read() {} })
  source.push(Buffer.alloc(bytes, 1))
  source.push(null)
  return source
}

describe.each(['WHEN_REQUIRED', 'WHEN_SUPPORTED'] as const)(
  'upload() takes ownership of a Readable body (%s)',
  (checksumMode) => {
    let server: Server
    let port: number
    let status = 500
    /** When set, the server reads the request and never answers, so only the client timeout ends it. */
    let stall = false
    let moduleRef: TestingModule | undefined
    const sockets = new Set<Socket>()

    beforeAll(async () => {
      server = createServer((req, res) => {
        req.resume()
        if (stall) {
          return
        }
        req.on('end', () => {
          res.statusCode = status
          res.setHeader('ETag', '"abc"')
          res.end()
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
      status = 500
      stall = false
    })

    async function storageWith(
      extra: Partial<BymaxStorageModuleOptions> = {},
    ): Promise<StorageService> {
      moduleRef = await Test.createTestingModule({
        imports: [
          BymaxStorageModule.forRoot({
            endpoint: `http://127.0.0.1:${String(port)}`,
            region: 'us-east-1',
            bucket: 'b',
            forcePathStyle: true,
            credentials: { accessKeyId: 'k', secretAccessKey: 's' },
            requestChecksumCalculation: checksumMode,
            responseChecksumValidation: checksumMode,
            maxAttempts: 1,
            requestTimeoutMs: 3000,
            ...extra,
          }),
        ],
      }).compile()
      await moduleRef.init()
      return moduleRef.get(StorageService)
    }

    async function reject(promise: Promise<unknown>): Promise<unknown> {
      return promise.catch((err: unknown) => err)
    }

    async function settle(): Promise<void> {
      await new Promise((resolve) => setImmediate(resolve))
    }

    it('destroys the stream when the content type is missing', async () => {
      const storage = await storageWith()
      const source = openStream()

      const error = await reject(storage.upload({ key: 'a', body: source, contentType: '' }))
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_CONTENT_TYPE_REQUIRED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the key is refused', async () => {
      const storage = await storageWith()
      const source = openStream()

      const error = await reject(
        storage.upload({ key: '../a', body: source, contentType: 'text/plain' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_KEY_INVALID' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the MIME type is not allowed', async () => {
      const storage = await storageWith({ validation: { mimeWhitelist: ['image/png'] } })
      const source = openStream()

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the declared size is over the limit', async () => {
      const storage = await storageWith({ validation: { maxSizeBytes: 10 } })
      const source = openStream()

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 64 }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when a custom validator rejects it', async () => {
      const storage = await storageWith({
        validation: {
          customValidators: [
            { name: 'no', validate: () => Promise.resolve({ ok: false as const, reason: 'no' }) },
          ],
        },
      })
      const source = openStream()

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the pre-upload scanner finds a threat', async () => {
      const scanner: IFileScanner = {
        scan: () => Promise.resolve({ status: 'infected', engine: 'test', threat: 'EICAR' }),
      }
      const storage = await storageWith({
        validation: { maxSizeBytes: 1024 },
        scanner: { impl: scanner, mode: 'pre-upload' },
      })
      // The scan reads the stream to its end first; autoDestroy is off so only the library can destroy it.
      const source = new Readable({ autoDestroy: false, read() {} })
      source.push(Buffer.alloc(64, 1))
      source.push(null)

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the provider rejects a single-shot upload', async () => {
      const storage = await storageWith()
      const source = endedStream()

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 64 }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream when the provider rejects a multipart upload', async () => {
      // A stream with no declared size takes the multipart path.
      const storage = await storageWith()
      const source = new Readable({ autoDestroy: false, read() {} })
      source.push(Buffer.alloc(64, 1))
      source.push(null)

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'text/plain' }),
      )
      await settle()

      expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
      expect(source.destroyed).toBe(true)
    })

    it('destroys the stream unread on an idempotency cache hit', async () => {
      status = 200
      const storage = await storageWith()
      await storage.upload({
        key: 'a',
        body: Buffer.from('first'),
        contentType: 'text/plain',
        idempotencyKey: 'order-1',
      })
      const source = openStream()

      const second = await storage.upload({
        key: 'a',
        body: source,
        contentType: 'text/plain',
        idempotencyKey: 'order-1',
      })
      await settle()

      expect(second.fromIdempotencyCache).toBe(true)
      expect(source.destroyed).toBe(true)
    })

    it('does not crash when the stream a cache hit discards fails to clean up', async () => {
      status = 200
      const storage = await storageWith()
      await storage.upload({
        key: 'a',
        body: Buffer.from('first'),
        contentType: 'text/plain',
        idempotencyKey: 'order-2',
      })
      const source = new Readable({
        read() {},
        destroy(_err, callback) {
          callback(new Error('resource close failed'))
        },
      })
      const crashed = jest.fn()
      process.once('uncaughtException', crashed)

      const second = await storage.upload({
        key: 'a',
        body: source,
        contentType: 'text/plain',
        idempotencyKey: 'order-2',
      })
      await settle()
      process.removeListener('uncaughtException', crashed)

      expect(second.fromIdempotencyCache).toBe(true)
      expect(crashed).not.toHaveBeenCalled()
      expect(source.destroyed).toBe(true)
    })

    it('leaves no unhandled error when the destroyed stream has no listener', async () => {
      // destroy(err) emits 'error'; with nobody listening that would crash the process.
      const storage = await storageWith({ validation: { mimeWhitelist: ['image/png'] } })
      const source = openStream()
      const crashed = jest.fn()
      process.once('uncaughtException', crashed)

      await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain' }))
      await settle()
      process.removeListener('uncaughtException', crashed)

      expect(crashed).not.toHaveBeenCalled()
      expect(source.destroyed).toBe(true)
    })

    it('does not crash when a validator that read the head of the stream then rejects it', async () => {
      // readBytes tees the stream; destroying the source with an error reaches the tee's replacement,
      // which nobody is listening to because the upload never started.
      const storage = await storageWith({
        validation: {
          customValidators: [
            {
              name: 'magic',
              async validate(ctx) {
                await ctx.readBytes?.(4)
                return { ok: false as const, reason: 'not a pdf' }
              },
            },
          ],
        },
      })
      const source = openStream()
      const crashed = jest.fn()
      process.once('uncaughtException', crashed)

      const error = await reject(
        storage.upload({ key: 'a', body: source, contentType: 'application/pdf' }),
      )
      await settle()
      process.removeListener('uncaughtException', crashed)

      expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
      expect(crashed).not.toHaveBeenCalled()
      expect(source.destroyed).toBe(true)
    })

    it('does not touch a Buffer body, and a successful stream upload still completes', async () => {
      status = 200
      const storage = await storageWith()
      const body = Readable.from([Buffer.from('abc')])

      const result = await storage.upload({ key: 'a', body, contentType: 'text/plain', size: 3 })
      const bufferResult = await storage.upload({
        key: 'b',
        body: Buffer.from('abc'),
        contentType: 'text/plain',
      })

      expect(result.key).toBe('a')
      expect(bufferResult.key).toBe('b')
    })

    /**
     * Runs an upload that is expected to reject and reports every error that escaped to the process.
     * The aftermath ends when the client has closed every connection (closing the module destroys
     * the client) and the event loop has turned enough times for what that queued to have run.
     */
    async function escapedErrors(
      attempt: () => Promise<unknown>,
    ): Promise<{ error: unknown; escaped: unknown[] }> {
      const escaped: unknown[] = []
      const onEscape = (err: unknown): void => {
        escaped.push(err)
      }
      process.on('uncaughtException', onEscape)
      const error = await reject(attempt())
      await moduleRef?.close()
      moduleRef = undefined
      while (sockets.size > 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      for (let turn = 0; turn < 20; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      process.removeListener('uncaughtException', onEscape)
      return { error, escaped }
    }

    it('does not let a request timeout re-emit on the SDK wrapper of an endless stream', async () => {
      stall = true
      const storage = await storageWith({ requestTimeoutMs: STALL_TIMEOUT_MS })
      const source = new Readable({ read() {} })

      const { error, escaped } = await escapedErrors(() =>
        storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 10 }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(escaped).toEqual([])
      expect(source.destroyed).toBe(true)
    })

    it('does not let a provider error re-emit on the SDK wrapper of a finished stream', async () => {
      const storage = await storageWith()
      const source = endedStream()

      const { error, escaped } = await escapedErrors(() =>
        storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 64 }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_PROVIDER_ERROR' })
      expect(escaped).toEqual([])
      expect(source.destroyed).toBe(true)
    })

    it('does not let a failed multipart upload re-emit on a wrapper of the stream', async () => {
      const storage = await storageWith()
      const source = new Readable({ autoDestroy: false, read() {} })
      source.push(Buffer.alloc(64, 1))
      source.push(null)

      const { error, escaped } = await escapedErrors(() =>
        storage.upload({ key: 'a', body: source, contentType: 'text/plain' }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_MULTIPART_ABORTED' })
      expect(escaped).toEqual([])
      expect(source.destroyed).toBe(true)
    })

    it('does not let a timeout crash after a validator read the head of the stream', async () => {
      stall = true
      const storage = await storageWith({
        requestTimeoutMs: STALL_TIMEOUT_MS,
        validation: {
          customValidators: [
            {
              name: 'magic',
              async validate(ctx) {
                await ctx.readBytes?.(4)
                return { ok: true as const }
              },
            },
          ],
        },
      })
      const source = openStream(4)

      const { error, escaped } = await escapedErrors(() =>
        storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 10 }),
      )

      expect(error).toMatchObject({ code: 'STORAGE_TIMEOUT' })
      expect(escaped).toEqual([])
      expect(source.destroyed).toBe(true)
    })
  },
)
