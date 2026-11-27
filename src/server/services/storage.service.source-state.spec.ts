/**
 * @fileoverview For every state a caller's stream can be in, an upload must settle, and end the
 * same way whichever path reads the stream first: the send itself, a custom validator that calls
 * `readBytes`, or the buffering of a pre-upload scan. Driven against a local S3 stand-in.
 * @layer server/services
 */
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough, Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { StorageException } from '../errors/storage-exception'
import type { BymaxStorageModuleOptions } from '../interfaces/storage-module-options.interface'
import type { IUploadValidator } from '../interfaces/upload-validator.interface'
import { peekFirstBytes, readStream } from '../utils/stream-utils'
import { StorageService } from './storage.service'

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const written = (): PassThrough => {
  const stream = new PassThrough()
  stream.write('abc')
  return stream
}

const ended = (): PassThrough => {
  const stream = written()
  stream.end()
  return stream
}

const failed = (): PassThrough => {
  const stream = written()
  stream.on('error', () => undefined)
  stream.destroy(new Error('boom'))
  return stream
}

const manual = (): Readable => new Readable({ autoDestroy: false, read: () => undefined })

/** A source that reports an error from its second read, by `fail`, and does not destroy itself. */
const failsMidRead = (fail: (stream: Readable) => void) => (): Promise<Readable> => {
  let reads = 0
  const stream: Readable = new Readable({
    autoDestroy: false,
    read: () => {
      reads += 1
      if (reads === 1) stream.push('abc')
      else if (reads === 2) setImmediate(fail, stream)
    },
  })
  stream.on('error', () => undefined)
  return Promise.resolve(stream)
}

/** How each state is reached, and the bytes a validator can still read from it. */
const STATES = {
  readable: { head: 'ab', make: () => Promise.resolve(ended()) },
  'ended but unread': {
    head: 'ab',
    make: async () => {
      const stream = ended()
      await tick()
      return stream
    },
  },
  paused: {
    head: 'ab',
    make: () => {
      const stream = ended()
      stream.pause()
      return Promise.resolve(stream)
    },
  },
  drained: {
    head: '',
    make: async () => {
      const stream = ended()
      stream.resume()
      await once(stream, 'end')
      await tick()
      return stream
    },
  },
  'drained and left open': {
    head: '',
    make: async () => {
      const stream = manual()
      stream.push('abc')
      stream.push(null)
      stream.resume()
      await once(stream, 'end')
      return stream
    },
  },
  'destroyed in the same tick': {
    head: '',
    make: () => {
      const stream = written()
      stream.destroy()
      return Promise.resolve(stream)
    },
  },
  'destroyed earlier': {
    head: '',
    make: async () => {
      const stream = written()
      stream.destroy()
      await tick()
      return stream
    },
  },
  'ended and destroyed unread': {
    head: '',
    make: async () => {
      const stream = ended()
      stream.destroy()
      await tick()
      return stream
    },
  },
  'errored in the same tick': { head: '', make: () => Promise.resolve(failed()) },
  'errored earlier': {
    head: '',
    make: async () => {
      const stream = failed()
      await tick()
      return stream
    },
  },
  'emptied and ended earlier': {
    head: '',
    make: async () => {
      const stream = new PassThrough()
      stream.end()
      stream.resume()
      await once(stream, 'end')
      return stream
    },
  },
  'errored earlier and left open': {
    head: '',
    make: async () => {
      const stream = new Readable({
        autoDestroy: false,
        read: () => {
          throw new Error('boom')
        },
      })
      stream.on('error', () => undefined)
      stream.read()
      await tick()
      return stream
    },
  },
  'emitting an error mid-read': {
    head: 'ab',
    make: failsMidRead((stream) => stream.emit('error', new Error('boom'))),
  },
  'recording an error mid-read': { head: 'ab', make: failsMidRead((stream) => stream.push(123)) },
} satisfies Record<string, { head: string; make: () => Promise<Readable> }>

type StateName = keyof typeof STATES

/** A drained source whose cleanup has not finished, and the call that makes the cleanup fail. */
async function drainedWithCleanupPending(): Promise<{ source: Readable; fail: () => void }> {
  let finish: (error: Error) => void = () => undefined
  const source = new Readable({
    read: () => undefined,
    destroy: (_error, done) => {
      finish = done
    },
  })
  source.push('abc')
  source.push(null)
  source.resume()
  await once(source, 'end')
  await tick()
  return {
    source,
    fail: () => {
      finish(new Error('cleanup failed'))
    },
  }
}

const MIB = 1024 * 1024

/** The declared size and the maximum of each shape. A scan needs a maximum to bound its buffer. */
const SHAPES = {
  'a declared size': { size: 3, maxSizeBytes: undefined, scanned: 100 },
  'a maximum only': { size: undefined, maxSizeBytes: 100, scanned: 100 },
  'no bound': { size: undefined, maxSizeBytes: undefined, scanned: undefined },
  'a multipart size': { size: 12 * MIB, maxSizeBytes: undefined, scanned: 20 * MIB },
}

/** Whether a validator calls `readBytes`, and whether the stream is buffered for a pre-upload scan. */
const PATHS = {
  'the send alone': { reads: false, scan: false },
  'a reading validator': { reads: true, scan: false },
  'a pre-upload scan': { reads: false, scan: true },
  'a reading validator and a scan': { reads: true, scan: true },
}

const SCANNING: Pick<BymaxStorageModuleOptions, 'scanner'> = {
  scanner: { mode: 'pre-upload', impl: { scan: () => Promise.resolve({ status: 'clean', engine: 'none' }) } },
}

const refused = 'STORAGE_VALIDATION_FAILED'
const provider = 'STORAGE_PROVIDER_ERROR'
const aborted = 'STORAGE_MULTIPART_ABORTED'

const whole: [string, string, string, string] = ['stored 3', 'stored 3', 'stored 3', refused]
const failure: [string, string, string, string] = [provider, aborted, aborted, aborted]

/** The outcome per state, in the order of `SHAPES`: the bytes stored, or the error code. */
const OUTCOMES: Record<StateName, [string, string, string, string]> = {
  readable: whole,
  'ended but unread': whole,
  paused: whole,
  drained: failure,
  'drained and left open': failure,
  'destroyed in the same tick': failure,
  'destroyed earlier': failure,
  'ended and destroyed unread': failure,
  'errored in the same tick': failure,
  'errored earlier': failure,
  'emptied and ended earlier': failure,
  'errored earlier and left open': failure,
  'emitting an error mid-read': failure,
  'recording an error mid-read': failure,
}

const rows = Object.entries(PATHS).flatMap(([path, through]) =>
  Object.entries(SHAPES).flatMap(([shape, limits], column) =>
    (Object.keys(STATES) as StateName[])
      .filter(() => !through.scan || limits.scanned !== undefined)
      .map(
        (state) => [path, state, shape, through, limits, OUTCOMES[state][column]] as const,
      ),
  ),
)

const code = (error: unknown): string =>
  ((error as StorageException).getResponse() as { error: { code: string } }).error.code

describe('an upload of a stream in each state it can be in', () => {
  let server: Server
  let stored: number[] = []
  let moduleRef: TestingModule | undefined

  beforeAll(async () => {
    server = createServer((req, res) => {
      let length = 0
      req.on('data', (chunk: Buffer) => {
        length += chunk.byteLength
      })
      req.on('end', () => {
        if (req.method === 'PUT') stored.push(length)
        res.setHeader('ETag', '"e"')
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
    stored = []
  })

  async function storageWith(
    validator: IUploadValidator,
    maxSizeBytes: number | undefined,
    scan = false,
  ): Promise<StorageService> {
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
          ...(scan ? SCANNING : {}),
          validation: {
            customValidators: [validator],
            ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
          },
        }),
      ],
    }).compile()
    await moduleRef.init()
    return moduleRef.get(StorageService)
  }

  /**
   * The validator reads twice, so the second read starts from the replacement the first one left,
   * and each read must settle. A source that failed is refused with the same code on every path.
   */
  it.each(rows)(
    'settles through %s: a %s source with %s',
    async (_path, state, _shape, through, limits, outcome) => {
      const heads: string[] = []
      const storage = await storageWith(
        {
          name: 'magic',
          validate: async ({ readBytes }) => {
            if (through.reads) {
              heads.push(String(await readBytes?.(2)), String(await readBytes?.(2)))
            }
            return { ok: true }
          },
        },
        through.scan ? limits.scanned : limits.maxSizeBytes,
        through.scan,
      )
      const settled = await storage
        .upload({
          key: 'k',
          body: await STATES[state].make(),
          contentType: 'text/plain',
          ...(limits.size === undefined ? {} : { size: limits.size }),
        })
        .then(() => `stored ${stored.join(',')}`, code)

      expect(settled).toBe(outcome)
      expect(heads).toEqual(through.reads ? [STATES[state].head, STATES[state].head] : [])
    },
  )

  /**
   * An error emitted while the library holds the stream and nothing reads it yet is past when the
   * read begins. An `emit` by hand records nothing.
   */
  it.each(
    Object.entries(PATHS).flatMap(([path, through]) =>
      [true, false].map((autoDestroy) => [path, autoDestroy, through] as const),
    ),
  )(
    'settles through %s on an error nothing was reading for (autoDestroy %s)',
    async (_path, autoDestroy, through) => {
      const source = new Readable({ autoDestroy, read: () => undefined })
      source.push('abc')
      const storage = await storageWith(
        {
          name: 'slow',
          validate: async () => {
            source.emit('error', new Error('boom'))
            await tick()
            return { ok: true }
          },
        },
        100,
        through.scan,
      )

      await expect(
        storage.upload({ key: 'k', body: source, contentType: 'text/plain' }).then(String, code),
      ).resolves.toBe(aborted)
      expect(source.destroyed).toBe(true)
      expect(stored).toEqual([])
    },
  )

  /**
   * A source that is empty and not yet read, and an empty buffer, are stored as empty objects, on
   * the single-request and the multipart strategy.
   */
  it.each(
    Object.entries(PATHS).flatMap(([path, through]) =>
      Object.entries({
        'an unread Readable.from([])': () => Readable.from([]),
        'an unread ended PassThrough': () => new PassThrough().end(),
        'an empty Buffer': () => Buffer.alloc(0),
      }).flatMap(([source, make]) =>
        [0, undefined].map((size) => [path, source, size, through, make] as const),
      ),
    ),
  )('stores 0 bytes through %s from %s (declared %s)', async (_p, _s, size, through, make) => {
    const storage = await storageWith(
      {
        name: 'magic',
        validate: async ({ readBytes }) => {
          if (through.reads) await readBytes?.(2)
          return { ok: true }
        },
      },
      100,
      through.scan,
    )

    await storage.upload({
      key: 'k',
      body: make(),
      contentType: 'text/plain',
      ...(size === undefined ? {} : { size }),
    })

    expect(stored).toEqual([0])
  })

  /** A validator that rejects leaves the replacement with no reader, whose error must not go unheard. */
  it.each(['destroyed earlier', 'errored in the same tick'] as const)(
    'raises nothing unheard when the validator rejects a %s source',
    async (state) => {
      const storage = await storageWith(
        {
          name: 'magic',
          validate: async ({ readBytes }) => {
            await readBytes?.(2)
            return { ok: false, reason: 'not wanted' }
          },
        },
        undefined,
      )

      await expect(
        storage.upload({ key: 'k', body: await STATES[state].make(), contentType: 'text/plain' }),
      ).rejects.toMatchObject({ response: { error: { code: refused } } })
      await tick()
      expect(stored).toEqual([])
    },
  )
})

describe('peekFirstBytes on a spent source', () => {
  /** The replacement fails with the source's own error, so the upload reports the real cause. */
  it('carries the error of an errored source', async () => {
    const source = failed()
    await tick()

    const { replacementBody } = await peekFirstBytes(source, 2)

    await expect(readStream(replacementBody as Readable)).rejects.toThrow('boom')
  })

  /** A stream can hold an error without being destroyed, when it does not destroy itself. */
  it('fails for an errored source that was left open', async () => {
    const source = manual()
    source.on('error', () => undefined)
    source.push(null)
    source.push('late')
    await tick()

    const { replacementBody } = await peekFirstBytes(source, 2)

    await expect(readStream(replacementBody as Readable)).rejects.toThrow('after EOF')
    expect(source.destroyed).toBe(true)
  })

  /** A drained source can still be cleaning up, and a failure of that must find a listener too. */
  it('hears a cleanup failure of a drained source', async () => {
    const { source, fail } = await drainedWithCleanupPending()

    const { replacementBody } = await peekFirstBytes(source, 2)
    fail()
    await tick()
    await tick()

    expect(source.errored).toMatchObject({ message: 'cleanup failed' })
    await expect(readStream(replacementBody as Readable)).rejects.toThrow('Premature close')
  })

  /** A destroy that reports its error later must find a listener, or the process fails. */
  it('hears the late error of a destroyed source', async () => {
    const source = new Readable({
      read: () => undefined,
      destroy: (_error, done) => {
        setImmediate(done, new Error('late'))
      },
    })
    source.destroy()

    const { head, replacementBody } = await peekFirstBytes(source, 2)
    await expect(readStream(replacementBody as Readable)).rejects.toMatchObject({
      code: 'ERR_STREAM_PREMATURE_CLOSE',
      message: 'Premature close',
    })
    await tick()
    await tick()

    expect(head).toHaveLength(0)
  })
})
