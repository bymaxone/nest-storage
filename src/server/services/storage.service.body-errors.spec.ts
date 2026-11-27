/**
 * @fileoverview An upload whose source stream fails settles with an error, and no error of that stream
 * goes unhandled. Run with the SDK's default checksum settings.
 * @layer server/services
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { STORAGE_ERROR_CODES } from '../../shared'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { StorageService } from './storage.service'

const CHUNK = Buffer.alloc(100_000, 1)
const SIZE = 2 * CHUNK.length

const later = (work: () => void): void => {
  setTimeout(() => {
    work()
  }, 30)
}

/** A source that gives one chunk and then does what `then` says; `release` is what its `destroy` fails with. */
const source = (then?: (stream: Readable) => void, release?: Error): Readable => {
  let reads = 0
  const stream: Readable = new Readable({
    read: () => {
      reads += 1
      if (reads > 1) return
      stream.push(CHUNK)
      if (then)
        later(() => {
          then(stream)
        })
    },
    destroy: (error, done) => {
      done(release ?? error)
    },
  })
  return stream
}

/** A source whose `destroy` reports an end instead of closing. */
const endsOnDestroy = (): Readable => {
  const stream = source()
  stream.destroy = () => {
    stream.emit('end')
    return stream
  }
  return stream
}

interface Case {
  readonly make: () => NodeJS.ReadableStream
  readonly refused?: boolean
  readonly code?: string
}

const CASES: Record<string, Case> = {
  'errors midway': { make: () => source((s) => s.destroy(new Error('boom'))) },
  'reports an error without destroying itself': {
    make: () => source((s) => s.emit('error', new Error('boom'))),
  },
  'reports a second error after the first': {
    make: () =>
      source((s) => {
        s.emit('error', new Error('boom'))
        s.emit('error', new Error('again'))
      }),
  },
  'fails to be destroyed after the provider refused': {
    make: () => source(undefined, new Error('cleanup')),
    refused: true,
  },
  'ends short of its declared size': {
    make: () => source((s) => s.push(null)),
    code: STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED,
  },
  'runs past its declared size': {
    make: () =>
      source((s) => {
        s.push(CHUNK)
        s.push(CHUNK)
      }),
    code: STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED,
  },
  'is destroyed with no error': { make: () => source((s) => s.destroy()) },
  'goes silent': { make: () => source(), code: STORAGE_ERROR_CODES.STORAGE_TIMEOUT },
}

describe('a checksummed upload whose source stream fails', () => {
  let server: Server
  let moduleRef: TestingModule
  let storage: StorageService
  let refuses = false

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('error', () => undefined)
      if (!refuses) return
      setTimeout(() => {
        res.statusCode = 403
        res.setHeader('connection', 'close')
        res.end('<Error><Code>AccessDenied</Code></Error>')
      }, 60)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRoot({
          endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
          region: 'us-east-1',
          bucket: 'test-bucket',
          forcePathStyle: true,
          credentials: { accessKeyId: 'k', secretAccessKey: 's' },
          maxAttempts: 1,
          requestTimeoutMs: 800,
        }),
      ],
    }).compile()
    await moduleRef.init()
    storage = moduleRef.get(StorageService)
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    await moduleRef.close()
  })

  const upload = (
    body: NodeJS.ReadableStream,
    extra: Partial<UploadOptions> = {},
  ): ReturnType<StorageService['upload']> =>
    storage.upload({ key: 'k', body, contentType: 'text/plain', size: SIZE, ...extra })

  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))

  // The wait after the rejection lets a late stream error reach the test, which would fail it.
  it.each(Object.entries(CASES))('settles with an error when the source %s', async (_n, given) => {
    refuses = given.refused ?? false

    await expect(upload(given.make())).rejects.toMatchObject({
      response: { error: { code: given.code ?? STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR } },
    })
    await settled()
  })

  // The caller giving up releases the source, whose cleanup may itself fail.
  it('settles as aborted when the source fails to be destroyed', async () => {
    refuses = false

    await expect(
      upload(source(undefined, new Error('cleanup')), { abortSignal: AbortSignal.timeout(80) }),
    ).rejects.toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_REQUEST_ABORTED } },
    })
    await settled()
  })

  // A release that reports an end leaves the size guard short of its declared size.
  it('settles with the refusal when the source reports an end as it is destroyed', async () => {
    refuses = true

    await expect(upload(endsOnDestroy())).rejects.toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR } },
    })
    await settled()
  })

  // A body that failed before the send may not report it again.
  it('settles with an error when the source had already failed', async () => {
    refuses = false
    const body = source()
    body.on('error', () => undefined)
    body.destroy(new Error('boom'))
    await settled()

    await expect(upload(body)).rejects.toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR } },
    })
    await settled()
  })
})
