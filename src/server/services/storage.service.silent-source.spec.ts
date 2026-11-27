/**
 * @fileoverview A source that goes silent while it is read ahead of the request, by a pre-upload
 * scan or by a validator, has no request in flight to time it out. `uploadIdleTimeoutMs` ends it.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import { STORAGE_ERROR_CODES } from '../../shared'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import { StorageService } from './storage.service'

const IDLE_MS = 150

const scanned: Partial<BymaxStorageModuleOptions> = {
  scanner: {
    impl: { scan: () => Promise.resolve({ status: 'clean' as const, engine: 'test' }) },
    mode: 'pre-upload',
  },
  validation: { maxSizeBytes: 4096 },
}

const peeked: Partial<BymaxStorageModuleOptions> = {
  validation: {
    customValidators: [
      {
        name: 'reads-ahead',
        validate: async (input) => {
          await input.readBytes?.(1024)
          return { ok: true }
        },
      },
    ],
  },
}

/** A source that gives one chunk and then nothing, neither ending nor failing. */
function silent(): Readable {
  const source = new Readable({ read: () => undefined })
  source.push(Buffer.alloc(8, 1))
  return source
}

/** A source that gives `count` chunks, each after less than the idle time, and then ends. */
function slow(count: number): Readable {
  const source = new Readable({ read: () => undefined })
  let given = 0
  const timer = setInterval(() => {
    given += 1
    source.push(Buffer.alloc(8, 1))
    if (given === count) {
      clearInterval(timer)
      source.push(null)
    }
  }, IDLE_MS / 3)
  return source
}

describe('a source read ahead of the request', () => {
  let server: Server
  let requests = 0
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests += 1
      req.resume()
      req.on('end', () => {
        res.setHeader('ETag', '"abc"')
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
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
    requests = 0
  })

  async function storageWith(extra: Partial<BymaxStorageModuleOptions>): Promise<StorageService> {
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
          region: 'us-east-1',
          bucket: 'b',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          maxAttempts: 1,
          uploadIdleTimeoutMs: IDLE_MS,
          ...extra,
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  const upload = (
    storage: StorageService,
    body: Readable,
    size?: number,
    abortSignal?: AbortSignal,
  ): Promise<unknown> =>
    storage.upload({
      key: 'k',
      body,
      contentType: 'text/plain',
      ...(size === undefined ? {} : { size }),
      ...(abortSignal === undefined ? {} : { abortSignal }),
    })

  it.each([
    ['a pre-upload scan, size declared', scanned, 64],
    ['a pre-upload scan, no size', scanned, undefined],
    ['a validator that reads ahead, size declared', peeked, 64],
    ['a validator that reads ahead, no size', peeked, undefined],
  ])('is given up when it goes silent under %s', async (_n, options, size) => {
    const storage = await storageWith(options)
    const body = silent()

    await expect(upload(storage, body, size)).rejects.toMatchObject({
      response: {
        error: {
          code: STORAGE_ERROR_CODES.STORAGE_TIMEOUT,
          details: { phase: 'source-idle', idleMs: IDLE_MS },
        },
      },
    })
    expect(body.destroyed).toBe(true)
    expect(requests).toBe(0)
  })

  it.each([
    ['a single request', 64, 'upload-single'],
    ['parts', undefined, 'upload-multipart'],
  ])('names the upload the scan would have fed: %s', async (_n, size, op) => {
    const storage = await storageWith(scanned)

    await expect(upload(storage, silent(), size)).rejects.toMatchObject({
      response: { error: { details: { op } } },
    })
  })

  it('stores nothing when a validator swallows the refusal of its read', async () => {
    const storage = await storageWith({
      validation: {
        customValidators: [
          {
            name: 'swallows',
            validate: async (input) => {
              await input.readBytes?.(1024).catch(() => undefined)
              return { ok: true }
            },
          },
        ],
      },
    })
    const body = silent()

    const outcome = await upload(storage, body, 64).catch((error: unknown) => error)

    expect(outcome).toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR } },
    })
    expect(body.destroyed).toBe(true)
    expect(requests).toBe(0)
  })

  it.each([
    ['a pre-upload scan', scanned],
    ['a validator that reads ahead', peeked],
  ])('is waited for while it keeps delivering under %s', async (_n, options) => {
    const storage = await storageWith(options)

    await expect(upload(storage, slow(6), 48)).resolves.toMatchObject({ key: 'k' })
    expect(requests).toBe(1)
  })

  it.each([
    ['a pre-upload scan', scanned],
    ['a validator that reads ahead', peeked],
  ])('is not timed when the idle time is 0, under %s', async (_n, options) => {
    const storage = await storageWith({ ...options, uploadIdleTimeoutMs: 0 })
    const controller = new AbortController()
    setTimeout(() => {
      controller.abort()
    }, IDLE_MS * 3)

    await expect(
      storage.upload({
        key: 'k',
        body: silent(),
        contentType: 'text/plain',
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED } },
    })
  })

  // A listener or a clock of the library left behind would show as a difference from a call the caller cut.
  // An error raised with nothing listening would fail the running test.
  it.each([
    ['a pre-upload scan', scanned],
    ['a validator that reads ahead', peeked],
  ])('leaves the stream as an abort leaves it, under %s', async (_n, options) => {
    const left = async (extra: Partial<BymaxStorageModuleOptions>): Promise<string[]> => {
      const storage = await storageWith({ ...options, ...extra })
      const body = silent()
      const abort = new AbortController()
      const timer = setTimeout(() => {
        abort.abort()
      }, IDLE_MS * 3)
      await upload(storage, body, 64, abort.signal).catch(() => undefined)
      clearTimeout(timer)
      await new Promise((resolve) => setTimeout(resolve, 50))
      return body.eventNames().map((e) => `${String(e)}=${String(body.listenerCount(e))}`)
    }

    const onIdle = await left({})
    await moduleRef?.close()

    expect(onIdle).toEqual(await left({ uploadIdleTimeoutMs: 0 }))
  })
})
