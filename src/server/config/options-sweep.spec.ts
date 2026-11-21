/**
 * @fileoverview The Nth-operation sweep of the module options. Every object the options hold (the options
 * themselves, each group, the scanner and its `scan`, each validator, the whitelist) is wrapped in a Proxy that
 * shares one counter, and the Nth trap of the whole read throws a host error. N is looped until a run no longer
 * reaches the Nth trap, so no read depends on a hand-written list. Each N must end in the library's own
 * `STORAGE_INVALID_CONFIG` with the host error as its cause, never the raw throw; the run that reaches no
 * failing trap boots.
 * @layer server/config
 */
import { Test } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { BymaxStorageModule } from '../bymax-storage.module'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

interface Sweep {
  /** The traps reached so far. */
  hits: number
  /** The trap that throws; `0` throws none. */
  failAt: number
  /** The error the host throws. */
  readonly thrown: Error
}

/**
 * A Proxy over `target` whose every trap counts, throws at the trap `sweep.failAt`, and wraps what it returns.
 * The `then` of a nested object is not a trap: the module reads it later, when Nest awaits a provider the
 * options hold (the scanner), which is not a read of the options.
 */
function trapped<T extends object>(target: T, sweep: Sweep, nested = false): T {
  const reach = (): void => {
    sweep.hits += 1
    if (sweep.hits === sweep.failAt) throw sweep.thrown
  }
  const wrap = (value: unknown): unknown =>
    typeof value === 'object' && value !== null ? trapped(value, sweep, true) : value
  const handler: ProxyHandler<T> = {
    get(object, key, receiver) {
      if (nested && key === 'then') return undefined
      reach()
      return wrap(Reflect.get(object, key, receiver))
    },
    has(object, key) {
      reach()
      return Reflect.has(object, key)
    },
    ownKeys(object) {
      reach()
      return Reflect.ownKeys(object)
    },
    getOwnPropertyDescriptor(object, key) {
      reach()
      return Reflect.getOwnPropertyDescriptor(object, key)
    },
    getPrototypeOf(object) {
      reach()
      return Reflect.getPrototypeOf(object)
    },
  }
  return new Proxy(target, handler)
}

/** A valid set of options that sets every group and every key of each, so the sweep reaches all of them. */
function fullOptions(): Record<string, unknown> {
  return {
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'b',
    credentials: { accessKeyId: 'k', secretAccessKey: 's', sessionToken: 't' },
    forcePathStyle: true,
    publicBaseUrl: 'https://cdn.example.com',
    cdnBaseUrl: 'https://cdn2.example.com',
    defaultPublicRead: false,
    keyPrefix: 'tenant',
    defaultCacheControl: 'no-store',
    defaultContentDisposition: 'inline',
    signedUrls: { defaultGetTtlSeconds: 60, defaultPutTtlSeconds: 60, maxTtlSeconds: 600 },
    multipart: { thresholdBytes: 6 * 1024 * 1024, partSizeBytes: 5 * 1024 * 1024, queueSize: 2 },
    validation: {
      mimeWhitelist: ['image/*'],
      maxSizeBytes: 1024,
      customValidators: [{ validate: () => Promise.resolve() }],
    },
    scanner: {
      impl: { scan: () => Promise.resolve({ status: 'clean', engine: 'test' }) },
      mode: 'pre-upload',
      rejectOnUnknown: false,
      timeoutMs: 1000,
    },
    serverSideEncryption: 'AES256',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    requestTimeoutMs: 1000,
    uploadIdleTimeoutMs: 1000,
    bodyIdleTimeoutMs: 1000,
  }
}

/** What building the module over the options does, as the error it threw or `undefined`. */
type Build = (options: unknown) => Promise<unknown>

/** Runs the sweep: every trap N fails once, until a run reaches fewer than N traps. */
async function sweep(build: Build): Promise<{ traps: number; failures: unknown[] }> {
  const thrown = new Error('host getter SENTINEL-4242')
  const failures: unknown[] = []
  for (let failAt = 1; failAt <= 5000; failAt += 1) {
    const state: Sweep = { hits: 0, failAt, thrown }
    const error = await build(trapped(fullOptions(), state)).then(
      () => undefined,
      (err: unknown) => err,
    )
    if (state.hits < failAt) {
      expect(error).toBeUndefined()
      return { traps: state.hits, failures }
    }
    failures.push(error)
  }
  throw new Error('the sweep did not end')
}

describe('the options read under an Nth-trap sweep', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  const refusal = (error: unknown): { code: unknown; cause: unknown; body: string } => ({
    code: (error as StorageException).code,
    cause: (error as { cause?: unknown }).cause,
    body: JSON.stringify((error as StorageException).getResponse()),
  })

  it('forRoot refuses each failing read as STORAGE_INVALID_CONFIG, with the host error as the cause', async () => {
    const { traps, failures } = await sweep((options) =>
      Promise.resolve().then(() => {
        BymaxStorageModule.forRoot(options as never)
      }),
    )

    expect(traps).toBeGreaterThan(40)
    expect(failures).toHaveLength(traps)
    for (const error of failures) {
      const { code, cause, body } = refusal(error)
      expect(error).toBeInstanceOf(StorageException)
      expect(code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG)
      expect((cause as Error).message).toBe('host getter SENTINEL-4242')
      expect(body).not.toContain('SENTINEL-4242')
    }
  })

  it('forRootAsync refuses each failing read of the factory result the same way', async () => {
    const { traps, failures } = await sweep(async (options) => {
      await Test.createTestingModule({
        imports: [BymaxStorageModule.forRootAsync({ useFactory: () => options as never })],
      }).compile()
    })

    expect(traps).toBeGreaterThan(40)
    for (const error of failures) {
      const { code, cause } = refusal(error)
      expect(error).toBeInstanceOf(StorageException)
      expect(code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG)
      expect((cause as Error).message).toBe('host getter SENTINEL-4242')
    }
  })

  it('refuses a host error whose prototype cannot be read, which an instanceof check would throw on', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('prototype trap')
        },
      },
    )
    const options = {
      ...fullOptions(),
      get region(): string {
        throw hostile as Error
      },
    }

    let refused: unknown
    try {
      BymaxStorageModule.forRoot(options as never)
    } catch (error) {
      refused = error
    }

    expect(refused).toBeInstanceOf(StorageException)
    expect((refused as StorageException).code).toBe(STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG)
    expect((refused as StorageException).cause).toBe(hostile)
  })

  it('refuses a StorageException that the host throws as it refuses any host error, and keeps it as the cause', async () => {
    const host = new StorageException(
      STORAGE_ERROR_CODES.STORAGE_INVALID_CONFIG,
      500,
      { sentinel: 'HOST-TEXT' },
      'HOST-TEXT',
    )
    const fromGetter = {
      ...fullOptions(),
      get endpoint(): string {
        throw host
      },
    }

    const sync = ((): unknown => {
      try {
        BymaxStorageModule.forRoot(fromGetter as never)
      } catch (error) {
        return error
      }
      return undefined
    })()
    const async_ = await Test.createTestingModule({
      imports: [
        BymaxStorageModule.forRootAsync({
          useFactory: () => {
            throw host
          },
        }),
      ],
    })
      .compile()
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    for (const refused of [sync, async_]) {
      expect(refused).not.toBe(host)
      expect(refused).toBeInstanceOf(StorageException)
      expect((refused as StorageException).cause).toBe(host)
      expect(JSON.stringify((refused as StorageException).getResponse())).not.toContain('HOST-TEXT')
    }
  })
})
