/**
 * @fileoverview A stream body under a pre-upload scanner. The scanner reads the
 * stream, so the upload must be fed the same bytes from a buffer, bounded by
 * `validation.maxSizeBytes`; without a bound the stream is refused. A local HTTP
 * server records what the SDK really sends, so an upload that lost its body
 * cannot hide behind a mock.
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

interface Recorded {
  method: string
  path: string
  body: Buffer
}

/** A scanner that drains the stream it is given, as a real engine would. */
function drainingScanner(seen: number[]): IFileScanner {
  return {
    async scan(input) {
      let bytes = 0
      if (Buffer.isBuffer(input.body)) {
        bytes = input.body.length
      } else if (input.body) {
        for await (const chunk of input.body) {
          bytes += (chunk as Buffer).length
        }
      }
      seen.push(bytes)
      return { status: 'clean', engine: 'test' }
    },
  }
}

describe('pre-upload scan of a stream body', () => {
  let server: Server
  let port: number
  let requests: Recorded[] = []
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        requests.push({
          method: req.method ?? '',
          path: (req.url ?? '').split('?')[0] ?? '',
          body: Buffer.concat(chunks),
        })
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
    requests = []
  })

  async function storageWith(
    seen: number[],
    extra: Partial<BymaxStorageModuleOptions>,
  ): Promise<StorageService> {
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
          scanner: { impl: drainingScanner(seen), mode: 'pre-upload' },
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  it('stores every byte of a stream the scanner has read', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, { validation: { maxSizeBytes: 4096 } })
    const payload = Buffer.alloc(1024, 7)

    const result = await storage.upload({
      key: 'big.bin',
      body: Readable.from([payload.subarray(0, 600), payload.subarray(600)]),
      contentType: 'application/octet-stream',
    })

    expect(seen).toEqual([1024])
    const put = requests.find((r) => r.method === 'PUT')
    expect(put?.path).toBe('/b/big.bin')
    expect(put?.body.equals(payload)).toBe(true)
    expect(result.size).toBe(1024)
  })

  it('accepts a stream exactly as long as maxSizeBytes', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, { validation: { maxSizeBytes: 1024 } })

    await storage.upload({
      key: 'edge.bin',
      body: Readable.from([Buffer.alloc(1024, 1)]),
      contentType: 'application/octet-stream',
    })

    expect(requests.find((r) => r.method === 'PUT')?.body.length).toBe(1024)
  })

  it('refuses a stream longer than maxSizeBytes before the scanner and the provider see it', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, { validation: { maxSizeBytes: 1000 } })
    const body = Readable.from([Buffer.alloc(600, 1), Buffer.alloc(600, 2)])

    const error: unknown = await storage
      .upload({ key: 'too-big.bin', body, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    expect(JSON.stringify((error as { getResponse(): unknown }).getResponse())).toContain(
      'validation.maxSizeBytes',
    )
    expect(seen).toEqual([])
    expect(requests).toEqual([])
  })

  it('stops reading an endless stream at the limit instead of buffering it', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, { validation: { maxSizeBytes: 2048 } })
    let produced = 0
    const endless = new Readable({
      read() {
        produced += 512
        this.push(Buffer.alloc(512, 1))
      },
    })

    const error: unknown = await storage
      .upload({ key: 'endless.bin', body: endless, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    // Bounded by the limit plus the stream's own read-ahead, never the whole (endless) source.
    expect(produced).toBeLessThan(2048 * 32)
    expect(endless.destroyed).toBe(true)
  })

  it('refuses a stream when there is no maxSizeBytes to bound the buffer', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, {})

    const error: unknown = await storage
      .upload({ key: 'x.bin', body: Readable.from([Buffer.from('abc')]), contentType: 'text/plain' })
      .catch((err: unknown) => err)

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400 })
    const text = JSON.stringify((error as { getResponse(): unknown }).getResponse())
    expect(text).toContain('validation.maxSizeBytes')
    expect(text).toContain('post-upload')
    expect(seen).toEqual([])
    expect(requests).toEqual([])
  })

  it('leaves a Buffer body alone in pre-upload mode, with or without a bound', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, {})

    await storage.upload({ key: 'buf.bin', body: Buffer.from('abc'), contentType: 'text/plain' })

    expect(seen).toEqual([3])
    expect(requests.find((r) => r.method === 'PUT')?.body.toString()).toBe('abc')
  })

  it('does not buffer a stream in post-upload mode, which has no body to hand the scanner', async () => {
    const seen: number[] = []
    const storage = await storageWith(seen, {
      scanner: { impl: drainingScanner(seen), mode: 'post-upload' },
    })

    await storage.upload({
      key: 'post.bin',
      body: Readable.from([Buffer.from('abc')]),
      contentType: 'text/plain',
      size: 3,
    })

    // The scanner is called after the upload and receives no body.
    expect(requests.find((r) => r.method === 'PUT')?.body.toString()).toBe('abc')
    expect(seen).toEqual([0])
  })

  it('releases the original stream when a validator-teed stream is refused for its size', async () => {
    // The validator's readBytes replaces the body with a tee; refusing that replacement must close the source.
    const seen: number[] = []
    const storage = await storageWith(seen, {
      validation: {
        maxSizeBytes: 100,
        customValidators: [
          {
            name: 'magic',
            async validate(ctx) {
              await ctx.readBytes?.(4)
              return { ok: true }
            },
          },
        ],
      },
    })
    const source = new Readable({ read() {} })
    source.push(Buffer.alloc(80, 1))
    source.push(Buffer.alloc(80, 2))

    const error: unknown = await storage
      .upload({ key: 'teed.bin', body: source, contentType: 'application/octet-stream' })
      .catch((err: unknown) => err)
    await new Promise((resolve) => setImmediate(resolve))

    expect(error).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED' })
    expect(source.destroyed).toBe(true)
    expect(requests).toEqual([])
  })

  it('lets a validator read the head of a stream and still stores the whole body', async () => {
    // The other step that reads a stream before the upload: a validator calling readBytes.
    const seen: number[] = []
    const heads: string[] = []
    const storage = await storageWith(seen, {
      scanner: undefined as never,
      validation: {
        customValidators: [
          {
            name: 'magic',
            async validate(ctx) {
              heads.push((await ctx.readBytes?.(4))?.toString('ascii') ?? '')
              return { ok: true }
            },
          },
        ],
      },
    })
    const payload = Buffer.from('%PDF-1.7 rest of the document')

    await storage.upload({
      key: 'doc.pdf',
      body: Readable.from([payload]),
      contentType: 'application/pdf',
      size: payload.length,
    })

    expect(heads).toEqual(['%PDF'])
    expect(requests.find((r) => r.method === 'PUT')?.body.equals(payload)).toBe(true)
  })
})
