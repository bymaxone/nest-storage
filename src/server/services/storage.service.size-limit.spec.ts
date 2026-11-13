/**
 * @fileoverview The upload size bound holds for every body shape: a stream with no declared
 * size, a stream longer than the size its caller declared, and a buffer with no declared size.
 * Driven against a local S3 stand-in through the real SDK, so a multipart upload that is cut
 * off shows which calls reached the provider, including the abort.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { StorageException } from '../errors/storage-exception'
import { StorageService } from './storage.service'

const MIB = 1024 * 1024

/** The `details` a `StorageException` carries in its response body. */
function detailsOf(error: unknown): Record<string, unknown> {
  const body = (error as StorageException).getResponse() as {
    error?: { details?: Record<string, unknown> }
  }
  return body.error?.details ?? {}
}

/** A stream of `chunks` chunks of 1 MiB that ends on its own, counting what the consumer pulled. */
function mibStream(chunks: number): { stream: Readable; pulled: () => number } {
  let pulled = 0
  const stream = new Readable({
    read() {
      if (pulled >= chunks) {
        this.push(null)
        return
      }
      pulled += 1
      this.push(Buffer.alloc(MIB, 7))
    },
  })
  return { stream, pulled: () => pulled }
}

describe('upload size bound', () => {
  let server: Server
  let port: number
  let calls: string[] = []
  let putBodies: Buffer[] = []
  let moduleRef: TestingModule | undefined
  const sockets = new Set<Socket>()

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stand-in')
      const received: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        received.push(chunk)
      })
      req.on('end', () => {
        if (req.method === 'PUT' && !url.searchParams.has('partNumber')) {
          putBodies.push(Buffer.concat(received))
        }
        calls.push(`${req.method ?? ''} ${url.searchParams.has('uploads') ? 'uploads' : url.search.split('&')[0] ?? ''}`)
        if (req.method === 'POST' && url.searchParams.has('uploads')) {
          res.setHeader('content-type', 'application/xml')
          res.end(
            '<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>',
          )
        } else if (req.method === 'PUT' && url.searchParams.has('partNumber')) {
          res.setHeader('ETag', '"p"')
          res.end()
        } else if (req.method === 'DELETE') {
          res.statusCode = 204
          res.end()
        } else if (req.method === 'PUT') {
          res.setHeader('ETag', '"single"')
          res.end()
        } else {
          res.setHeader('content-type', 'application/xml')
          res.end('<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>')
        }
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

  beforeEach(() => {
    calls = []
    putBodies = []
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
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  it('refuses a stream with no declared size once it passes maxSizeBytes, aborts the upload and stops reading', async () => {
    // The SDK holds a whole 5 MiB part before it creates the upload, so a 6 MiB limit lets the first
    // part start and leaves an upload to abort.
    const storage = await storageWith({ validation: { maxSizeBytes: 6 * MIB } })
    const { stream, pulled } = mibStream(40)

    const error: unknown = await storage
      .upload({ key: 'big.bin', body: stream, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED', status: 413 })
    expect(detailsOf(error)).toMatchObject({ maxSize: 6 * MIB, abort: 'completed' })
    expect(calls).toContain('DELETE ?uploadId=u1')
    expect(calls).not.toContain('POST ?uploadId=u1')
    expect(stream.destroyed).toBe(true)
    expect(pulled()).toBeLessThan(40)
  })

  it('refuses a stream over maxSizeBytes before any part starts when the limit is under one part', async () => {
    // The SDK holds a whole part before it creates the upload, so nothing reached the provider and nothing is left to abort.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })
    const { stream } = mibStream(40)

    const error: unknown = await storage
      .upload({ key: 'small-limit.bin', body: stream, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(calls).toEqual([])
  })

  it('refuses a stream longer than the size its caller declared, on the multipart path', async () => {
    // A declared size at the threshold selects multipart; the bytes that follow must not exceed it.
    const storage = await storageWith({})
    const { stream } = mibStream(20)

    const error: unknown = await storage
      .upload({ key: 'liar.bin', body: stream, size: 6 * MIB, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(detailsOf(error)).toMatchObject({ declaredSize: 6 * MIB, abort: 'completed' })
    expect(calls).toContain('DELETE ?uploadId=u1')
  })

  it('refuses a buffer over maxSizeBytes when no size is declared, before any request', async () => {
    // A buffer is checked by its own length, whether or not its caller declares a size.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const error: unknown = await storage
      .upload({ key: 'buf.bin', body: Buffer.alloc(3 * MIB), contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED', status: 413 })
    expect(calls).toEqual([])
  })

  it('refuses a buffer larger than a smaller declared size, before any request', async () => {
    // The declared size cannot excuse a buffer whose real length is over the limit.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const error: unknown = await storage
      .upload({ key: 'buf.bin', body: Buffer.alloc(3 * MIB), size: 10, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(calls).toEqual([])
  })

  it('refuses a Uint8Array over maxSizeBytes when no size is declared', async () => {
    // A Uint8Array that is not a Buffer takes the same size check as a Buffer.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const error: unknown = await storage
      .upload({ key: 'u8.bin', body: new Uint8Array(3 * MIB), contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(calls).toEqual([])
  })

  it('refuses an ArrayBuffer over maxSizeBytes, which untyped callers can pass', async () => {
    // The type forbids it, but request-parsed data is not type-checked; its byte length counts.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const error: unknown = await storage
      .upload({
        key: 'ab.bin',
        body: new ArrayBuffer(3 * MIB) as unknown as Buffer,
        contentType: 'application/octet-stream',
      })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(calls).toEqual([])
  })

  it('measures a string body in UTF-8 bytes, not characters', async () => {
    // 600 000 characters of a 3-byte glyph are 1 800 000 bytes: over a 1 MiB limit, though under it as characters.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const error: unknown = await storage
      .upload({
        key: 'str.txt',
        body: '€'.repeat(600_000) as unknown as Buffer,
        contentType: 'text/plain',
      })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_SIZE_EXCEEDED' })
    expect(calls).toEqual([])
  })

  it('uploads a string body within the limit as its UTF-8 bytes', async () => {
    // The same normalisation that measures the string is what is sent.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    await expect(
      storage.upload({ key: 'str.txt', body: 'héllo' as unknown as Buffer, contentType: 'text/plain' }),
    ).resolves.toMatchObject({ size: 6 })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0]?.equals(Buffer.from('héllo', 'utf8'))).toBe(true)
  })

  it('uses a buffer\'s own length, not a larger size its caller declared, for strategy and result', async () => {
    // A buffer has one size. A declared 999 999 999 must not route 10 bytes to multipart or be reported back.
    const storage = await storageWith({ validation: { maxSizeBytes: MIB } })

    const result = await storage.upload({
      key: 'lie-big.bin',
      body: Buffer.alloc(10),
      size: 999_999_999,
      contentType: 'application/octet-stream',
    })

    expect(result).toMatchObject({ multipart: false, size: 10 })
    expect(calls).toEqual(['PUT ?x-id=PutObject'])
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0]?.length).toBe(10)
  })

  it('sends the whole buffer when its caller declared a smaller size', async () => {
    // Content-Length must follow the bytes, or the provider refuses the request.
    const storage = await storageWith({})

    const result = await storage.upload({
      key: 'lie-small.bin',
      body: Buffer.alloc(3 * MIB),
      size: 10,
      contentType: 'application/octet-stream',
    })

    expect(result).toMatchObject({ size: 3 * MIB })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0]?.length).toBe(3 * MIB)
  })

  it('still uploads a stream that stays within the limit', async () => {
    // The bound must not touch a healthy upload: 6 MiB through a 8 MiB limit completes.
    const storage = await storageWith({ validation: { maxSizeBytes: 8 * MIB } })
    const { stream } = mibStream(6)

    const result = await storage.upload({ key: 'ok.bin', body: stream, contentType: 'application/octet-stream' })

    expect(result.multipart).toBe(true)
    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([])
    expect(calls).toContain('POST ?uploadId=u1')
  })

  it('accepts a stream of exactly maxSizeBytes', async () => {
    // The bound is "more than", not "at least": the limit itself is allowed.
    const storage = await storageWith({ validation: { maxSizeBytes: 6 * MIB } })
    const { stream } = mibStream(6)

    await expect(
      storage.upload({ key: 'edge.bin', body: stream, contentType: 'application/octet-stream' }),
    ).resolves.toMatchObject({ multipart: true })
  })
})
