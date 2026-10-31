/**
 * @fileoverview The library takes ownership of a `Readable` body on `upload()`, as
 * `stream.pipeline` does: after any rejection the source stream is destroyed, which
 * releases the file handle or socket behind it. Every rejection path is driven here,
 * against a local server for the provider failures.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { IFileScanner } from '../interfaces/file-scanner.interface'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageService } from './storage.service'

/** A readable that never ends on its own, so only a destroy can close it. */
function openStream(bytes = 64): Readable {
  const source = new Readable({ read() {} })
  source.push(Buffer.alloc(bytes, 1))
  return source
}

describe('upload() takes ownership of a Readable body', () => {
  let server: Server
  let port: number
  let status = 500
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.statusCode = status
        res.setHeader('ETag', '"abc"')
        res.end()
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
  })

  async function storageWith(extra: Partial<BymaxStorageModuleOptions> = {}): Promise<StorageService> {
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

    const error = await reject(storage.upload({ key: '../a', body: source, contentType: 'text/plain' }))
    await settle()

    expect(error).toMatchObject({ code: 'STORAGE_KEY_INVALID' })
    expect(source.destroyed).toBe(true)
  })

  it('destroys the stream when the MIME type is not allowed', async () => {
    const storage = await storageWith({ validation: { mimeWhitelist: ['image/png'] } })
    const source = openStream()

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain' }))
    await settle()

    expect(error).toMatchObject({ code: 'STORAGE_MIME_NOT_ALLOWED' })
    expect(source.destroyed).toBe(true)
  })

  it('destroys the stream when the declared size is over the limit', async () => {
    const storage = await storageWith({ validation: { maxSizeBytes: 10 } })
    const source = openStream()

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain', size: 64 }))
    await settle()

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(source.destroyed).toBe(true)
  })

  it('destroys the stream when a custom validator rejects it', async () => {
    const storage = await storageWith({
      validation: {
        customValidators: [{ name: 'no', validate: () => Promise.resolve({ ok: false as const, reason: 'no' }) }],
      },
    })
    const source = openStream()

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain' }))
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

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain' }))
    await settle()

    expect(error).toMatchObject({ code: 'STORAGE_SCAN_INFECTED' })
    expect(source.destroyed).toBe(true)
  })

  it('destroys the stream when the provider rejects a single-shot upload', async () => {
    const storage = await storageWith()
    const source = openStream()

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

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'text/plain' }))
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

    const error = await reject(storage.upload({ key: 'a', body: source, contentType: 'application/pdf' }))
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
    const bufferResult = await storage.upload({ key: 'b', body: Buffer.from('abc'), contentType: 'text/plain' })

    expect(result.key).toBe('a')
    expect(bufferResult.key).toBe('b')
  })
})
