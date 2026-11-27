/**
 * @fileoverview A custom validator that calls `readBytes` reads the stream before the upload does.
 * For every state a caller's stream can be in when the upload begins, the upload with such a
 * validator must end as the upload without one does. Driven against a local S3 stand-in.
 * @layer server/services
 */
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough, Readable } from 'node:stream'
import { Test, type TestingModule } from '@nestjs/testing'
import { BymaxStorageModule } from '../bymax-storage.module'
import type { StorageException } from '../errors/storage-exception'
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
} satisfies Record<string, { head: string; make: () => Promise<Readable> }>

type StateName = keyof typeof STATES

const SHAPES = {
  'a declared size': { size: 3, maxSizeBytes: undefined },
  'a maximum only': { size: undefined, maxSizeBytes: 100 },
  'no bound': { size: undefined, maxSizeBytes: undefined },
  'a multipart size': { size: 12 * 1024 * 1024, maxSizeBytes: undefined },
}

const refused = 'STORAGE_VALIDATION_FAILED'
const provider = 'STORAGE_PROVIDER_ERROR'
const aborted = 'STORAGE_MULTIPART_ABORTED'

/** The outcome per state, in the order of `SHAPES`: the bytes stored, or the error code. */
const OUTCOMES: Record<StateName, [string, string, string, string]> = {
  readable: ['stored 3', 'stored 3', 'stored 3', refused],
  'ended but unread': ['stored 3', 'stored 3', 'stored 3', refused],
  paused: ['stored 3', 'stored 3', 'stored 3', refused],
  drained: [refused, 'stored 0', 'stored 0', refused],
  'drained and left open': [refused, 'stored 0', 'stored 0', refused],
  'destroyed in the same tick': [provider, aborted, aborted, aborted],
  'destroyed earlier': [provider, aborted, aborted, aborted],
  'ended and destroyed unread': [provider, aborted, aborted, aborted],
  'errored in the same tick': [provider, aborted, aborted, aborted],
  'errored earlier': [provider, aborted, aborted, aborted],
}

const rows = Object.entries(SHAPES).flatMap(([shape, limits], column) =>
  (Object.keys(STATES) as StateName[]).map(
    (state) => [state, shape, limits, OUTCOMES[state][column]] as const,
  ),
)

describe('a validator that reads a stream before the upload does', () => {
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
   * Every state against every size shape. The validator reads twice, so the second read starts from
   * the replacement the first one left, and each read must settle.
   */
  it.each(rows)('settles a %s source with %s', async (state, _shape, limits, outcome) => {
    const heads: string[] = []
    const storage = await storageWith(
      {
        name: 'magic',
        validate: async ({ readBytes }) => {
          heads.push(String(await readBytes?.(2)), String(await readBytes?.(2)))
          return { ok: true }
        },
      },
      limits.maxSizeBytes,
    )
    const settled = await storage
      .upload({
        key: 'k',
        body: await STATES[state].make(),
        contentType: 'text/plain',
        ...(limits.size === undefined ? {} : { size: limits.size }),
      })
      .then(
        () => `stored ${stored.join(',')}`,
        (error: unknown) =>
          ((error as StorageException).getResponse() as { error: { code: string } }).error.code,
      )

    expect(settled).toBe(outcome)
    expect(heads).toEqual([STATES[state].head, STATES[state].head])
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
