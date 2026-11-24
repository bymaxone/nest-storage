/**
 * @fileoverview Every await on a decision path goes through a hop that pins the promise it hands back and follows
 * the work with the `then` captured at load, so a host that plants a `constructor`, a `then` or a throwing species
 * while its own code runs (a request getter, a tracer, middleware) cannot answer a validation, a scan or a
 * readiness check in the library's place.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import { StorageHealthIndicator } from '../../observability/storage-health'
import { StorageException } from '../errors/storage-exception'
import { StorageObserver } from '../observability/storage-observer'
import { StorageMetricsTally } from '../observability/storage-metrics-tally'
import { StorageService } from '../services/storage.service'
import { FileScannerService } from '../services/file-scanner.service'
import { INTRINSIC_PROMISE, tagged } from './prototype-guard'
import { abortable } from './abort-support'
import { allOf, mirrorOf, settleOrCut, verdictOf } from './settle-or-cut'

const proto: object = Promise.prototype
const realConstructor = Object.getOwnPropertyDescriptor(proto, 'constructor')!

/**
 * What a host's call does: leaves one-shot accessors on `Promise.prototype` for `constructor` and `then`, each
 * restoring itself the first time it is read, so the checks before and after a bare `await` find a clean prototype
 * while the await itself reads a forged constructor and a forged `then`.
 */
function plantForgery(answer: unknown): void {
  const thenKey = Object.getOwnPropertyDescriptor(proto, 'then')!
  Reflect.defineProperty(proto, 'then', {
    configurable: true,
    get() {
      Reflect.defineProperty(proto, 'then', thenKey)
      return (resolve: (value: unknown) => void) => {
        resolve(answer)
      }
    },
  })
  Reflect.defineProperty(proto, 'constructor', {
    configurable: true,
    get() {
      Reflect.defineProperty(proto, 'constructor', realConstructor)
      return function Forged() {
        // A constructor that is not the engine's.
      }
    },
  })
}

/**
 * What a request field getter does between the entry check and a bare `await`: a constructor accessor that erases
 * itself on the first read of an await and leaves an own, self-erasing `then` on the promise being awaited, so the
 * prototype is clean again before any later check and the await alone answers with `answer`. The library's own
 * captured reads (marking a promise handled, following one) pass through.
 */
function plantOneShot(answer: unknown): void {
  Reflect.defineProperty(proto, 'constructor', {
    configurable: true,
    get(this: object) {
      if (/markHandled|follow|handleWithoutSpecies|pinConstructor/.test(new Error().stack ?? '')) {
        return realConstructor.value as unknown
      }
      Reflect.defineProperty(proto, 'constructor', realConstructor)
      Reflect.defineProperty(this, 'then', {
        configurable: true,
        value(this: object, resolve: (value: unknown) => void) {
          Reflect.deleteProperty(this, 'then')
          resolve(answer)
        },
      })
      return function Forged() {
        // A constructor that is not the engine's.
      }
    },
  })
}

const realThen = Object.getOwnPropertyDescriptor(proto, 'then')!

function restoreConstructor(): void {
  Reflect.defineProperty(proto, 'constructor', realConstructor)
  Reflect.defineProperty(proto, 'then', realThen)
}

/** A provider whose client records the body of every request and waits `beforeStore` before it answers. */
function fakeProvider(sent: string[], beforeStore: () => Promise<void>): object {
  return {
    isConfigured: () => true,
    getClient: () => ({
      send: async (command: { input: { Body: unknown } }) => {
        await beforeStore()
        sent.push(String(command.input.Body))
        return { ETag: '"e"' }
      },
    }),
  }
}

/** A service wired with fakes, whose validator always refuses and whose client records what it is sent. */
function serviceWith(
  observer?: StorageObserver,
  scanner?: { status: 'clean' | 'infected'; engine: string },
  scanned: string[] = [],
  beforeStore: () => Promise<void> = () => Promise.resolve(),
): { service: StorageService; sent: string[] } {
  const sent: string[] = []
  const options = {
    bucket: 'b',
    publicBaseUrl: 'https://cdn.example',
    multipart: { thresholdBytes: 1e9 },
    validation: { maxSizeBytes: 1000 },
    ...(scanner ? { scanner: { mode: 'pre-upload', timeoutMs: 1000 } } : {}),
  }
  const provider = fakeProvider(sent, beforeStore)
  const validation = {
    checkHeaders: () => undefined,
    validate: (input: { body: unknown }) =>
      scanner
        ? Promise.resolve({ body: input.body })
        : Promise.reject(new Error('validator refused this body')),
  }
  const scanning = new FileScannerService(
    options as never,
    scanner
      ? {
          scan: (input: { body?: Buffer | NodeJS.ReadableStream }) => {
            scanned.push(Buffer.isBuffer(input.body) ? input.body.toString() : 'stream')
            return Promise.resolve(scanner)
          },
        }
      : null,
    observer,
  )
  const service = new StorageService(
    options as never,
    provider as never,
    { normalize: (key: string) => key, stripPrefix: (key: string) => key } as never,
    {} as never,
    validation as never,
    scanning,
    observer,
  )
  return { service, sent }
}

describe('the hop every decision path goes through', () => {
  afterEach(() => {
    restoreConstructor()
  })

  it('keeps a validator refusal when a request getter plants a constructor before the validation await', async () => {
    const { service, sent } = serviceWith()
    const request = {
      body: Buffer.from('x'),
      contentType: 'text/plain',
      get key() {
        plantOneShot({ body: Buffer.from('UNVALIDATED'), contentType: 'text/plain' })
        return 'k'
      },
    }

    // Either the validator's own refusal or the library's refusal of the planted runtime: never an accepted upload.
    await expect(service.upload(request)).rejects.toBeDefined()
    expect(sent).toEqual([])
  })

  it('keeps a failed upload failed through the observer when a request getter plants a constructor', async () => {
    const observer = new StorageObserver(new StorageMetricsTally(), {
      span: (...a: unknown[]) => (a[2] as () => unknown)(),
    } as never)
    const { service } = serviceWith(observer)
    const request = {
      body: Buffer.from('x'),
      contentType: 'text/plain',
      get key() {
        plantOneShot({ key: 'forged', etag: 'x', forged: true })
        return 'k'
      },
    }

    await expect(service.upload(request)).rejects.toBeDefined()
  })

  it('stores the bytes it scanned when a live `then` is replaced to swap the scanned buffer', async () => {
    const original = Promise.prototype.then
    let held: Buffer | undefined
    Promise.prototype.then = function swapping(
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return (original as (...a: unknown[]) => unknown).call(
        this,
        (value: unknown) => {
          let answer = value
          if (held === undefined && Buffer.isBuffer(value) && value.toString() === 'CLEAN') {
            held = Buffer.from('CLEAN')
            answer = held
            setTimeout(() => held?.write('EVIL!'), 5)
          }
          return onFulfilled?.(answer)
        },
        onRejected,
      )
    } as typeof Promise.prototype.then
    const scanned: string[] = []
    const built = serviceWith(undefined, { status: 'clean', engine: 'test' }, scanned, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    try {
      await built.service
        .upload({
          body: Readable.from([Buffer.from('CLEAN')]),
          size: 5,
          contentType: 'text/plain',
          key: 'k',
        })
        .catch(() => undefined)
    } finally {
      Promise.prototype.then = original
    }

    expect(built.sent).toEqual(scanned.slice(0, built.sent.length))
    expect(built.sent.join('')).not.toContain('EVIL')
  })

  it('refuses without an unhandled rejection when the engine species getter throws', async () => {
    const species = Object.getOwnPropertyDescriptor(INTRINSIC_PROMISE, Symbol.species)!
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const work = new INTRINSIC_PROMISE((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('scanner failed'))
      }, 5)
    })
    // The getter is live only for the synchronous start of the call: the test runner reads the species of its own
    // promises whenever the test yields, and it must not meet the planted getter.
    let verdict: Promise<unknown>
    Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, {
      configurable: true,
      get() {
        throw new Error('species')
      },
    })
    try {
      verdict = verdictOf(work)
    } finally {
      Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, species)
    }
    let outcome: unknown
    try {
      outcome = await verdict
    } catch (error) {
      outcome = error
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    process.off('unhandledRejection', listener)

    expect(outcome).toBeInstanceOf(StorageException)
    expect(unhandled).toEqual([])
  })

  it.each(['constructor and then planted by the host call'])(
    'answers a failing health probe `down` with %s',
    async () => {
      const unavailable = Object.assign(new Error('Service Unavailable'), {
        name: 'ServiceUnavailable',
        $metadata: { httpStatusCode: 503 },
      })
      const storage = new StorageService(
        { bucket: 'b', multipart: { thresholdBytes: 1e9 } } as never,
        {
          isConfigured: () => true,
          getClient: () => ({
            send: () => {
              plantForgery({ status: 'up' })
              return Promise.reject(unavailable)
            },
          }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
      )

      await expect(new StorageHealthIndicator(storage).check()).resolves.toEqual({ status: 'down' })
    },
  )

  it('pins the constructor of a promise it hands back so it cannot be redefined or reassigned', () => {
    const pinned = tagged(Promise.resolve(1))
    const descriptor = Object.getOwnPropertyDescriptor(pinned, 'constructor')!

    expect(descriptor.value).toBe(INTRINSIC_PROMISE)
    expect(descriptor.configurable).toBe(false)
    expect(descriptor.writable).toBe(false)
  })

  it('pins the constructor even when `get` and `set` are planted on Object.prototype', () => {
    Object.defineProperty(Object.prototype, 'get', { configurable: true, get: () => () => 'x' })
    Object.defineProperty(Object.prototype, 'set', { configurable: true, get: () => () => 'x' })
    let value: unknown
    try {
      value = Object.getOwnPropertyDescriptor(tagged(Promise.resolve(1)), 'constructor')?.value
    } finally {
      Reflect.deleteProperty(Object.prototype, 'get')
      Reflect.deleteProperty(Object.prototype, 'set')
    }

    expect(value).toBe(INTRINSIC_PROMISE)
  })

  it('hands back a rejected refusal, never the untagged promise, when the constructor cannot be pinned', async () => {
    const frozen = Object.freeze(Promise.resolve(1))

    await expect(tagged(frozen)).rejects.toBeInstanceOf(StorageException)
  })

  it('never answers with a forged value when the release of a cut plants a constructor', async () => {
    let answer: unknown
    try {
      answer = await settleOrCut(Promise.resolve('real'), () => () => {
        plantForgery('forged')
      })
    } catch (error) {
      answer = error
    }

    expect(answer).not.toBe('forged')
  })

  it('answers an empty list with an empty list', async () => {
    await expect(allOf([])).resolves.toEqual([])
  })

  it('answers every item in order, a plain value among them', async () => {
    await expect(allOf([Promise.resolve(1), 2, Promise.resolve(3)])).resolves.toEqual([1, 2, 3])
  })

  it('ends with the first rejection of a list', async () => {
    await expect(
      allOf([Promise.resolve(1), Promise.reject(new Error('part failed'))]),
    ).rejects.toThrow('part failed')
  })

  it('rejects with the error a thenable throws when its `then` is read', async () => {
    const hostile = {
      get then(): never {
        throw new Error('then getter')
      },
    }

    await expect(verdictOf(hostile)).rejects.toThrow('then getter')
  })

  it('answers `down` when the shared wait itself rejects', async () => {
    const indicator = new StorageHealthIndicator({
      checkBucket: () => Promise.resolve(),
    } as never)
    Object.assign(indicator, { waitFor: () => Promise.reject(new Error('wait failed')) })

    await expect(indicator.check()).resolves.toEqual({ status: 'down' })
  })

  it('hands the host a mirror that follows the work and carries its own handled marker', async () => {
    const failing = Promise.reject(new Error('span failed'))
    const mirror = mirrorOf(failing)

    expect(mirror).not.toBe(failing)
    await expect(failing).rejects.toThrow('span failed')
    await expect(mirrorOf(undefined)).resolves.toBeUndefined()
  })

  it('refuses an item whose species throws and leaves no unhandled rejection behind', async () => {
    const species = Object.getOwnPropertyDescriptor(INTRINSIC_PROMISE, Symbol.species)!
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const item = new INTRINSIC_PROMISE((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('part failed'))
      }, 5)
    })
    let joined: Promise<unknown[]>
    Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, {
      configurable: true,
      get() {
        throw new Error('species')
      },
    })
    try {
      joined = allOf([item])
    } finally {
      Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, species)
    }
    let outcome: unknown
    try {
      outcome = await joined
    } catch (error) {
      outcome = error
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    process.off('unhandledRejection', listener)

    expect(outcome).toBeInstanceOf(StorageException)
    expect(unhandled).toEqual([])
  })

  it('mirrors work that fulfils', async () => {
    await expect(mirrorOf(Promise.resolve('done'))).resolves.toBeUndefined()
  })

  describe('with a host promise whose call planted one-shot accessors for `constructor` and `then`', () => {
    const hops: [
      string,
      (work: Promise<string>) => Promise<unknown>,
      (value: string) => unknown,
    ][] = [
      ['verdictOf', (work) => verdictOf(work), (value) => value],
      ['allOf', (work) => allOf([work]), (value) => [value]],
      [
        'settleOrCut',
        (work) =>
          settleOrCut(work, () => () => {
            // Nothing to release.
          }),
        (value) => value,
      ],
      ['abortable', (work) => abortable(work, new AbortController().signal, {}), (value) => value],
    ]

    it.each(hops)(
      '%s answers what the host promise fulfilled with',
      async (_name, hop, expected) => {
        const hostCall = (): Promise<string> => {
          const work = Promise.resolve('REAL')
          plantForgery('FORGED')
          return work
        }

        await expect(hop(hostCall())).resolves.toEqual(expected('REAL'))
      },
    )

    it.each(hops)('%s keeps what the host promise rejected with', async (_name, hop) => {
      const failure = new Error('host failed')
      const hostCall = (): Promise<string> => {
        const work = Promise.reject<string>(failure)
        plantForgery('FORGED')
        return work
      }

      await expect(hop(hostCall())).rejects.toBe(failure)
    })
  })

  describe('when the `constructor` slot of the promise prototype was replaced before a module loaded', () => {
    const loaders: [string, () => unknown][] = [
      ['the server guard', () => jest.requireActual<object>('./prototype-guard')],
      [
        'the health indicator',
        () => {
          jest.doMock('@bymax-one/nest-storage', () => ({ StorageService: class {} }))
          return jest.requireActual<object>('../../observability/storage-health')
        },
      ],
    ]

    function loadWith(replacement: unknown, load: () => unknown): unknown {
      Reflect.defineProperty(proto, 'constructor', {
        configurable: true,
        writable: true,
        value: replacement,
      })
      try {
        let loaded: unknown
        jest.isolateModules(() => {
          loaded = load()
        })
        return loaded
      } finally {
        restoreConstructor()
      }
    }

    it.each(loaders)('%s refuses a forging function', (_name, load) => {
      expect(() =>
        loadWith(function Forged() {
          // Not the engine's.
        }, load),
      ).toThrow('not the engine one')
    })

    it.each(loaders)('%s refuses a slot that is not a function', (_name, load) => {
      expect(() => loadWith('forged', load)).toThrow('not the engine one')
    })

    it.each(loaders)('%s loads when the slot is untouched', (_name, load) => {
      expect(() => loadWith(realConstructor.value, load)).not.toThrow()
    })
  })

  it('hands a mirror of a promise whose species throws a refusal, never a hang', async () => {
    const species = Object.getOwnPropertyDescriptor(INTRINSIC_PROMISE, Symbol.species)!
    const work = Promise.resolve('x')
    let mirror: Promise<undefined>
    Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, {
      configurable: true,
      get() {
        throw new Error('species')
      },
    })
    try {
      mirror = mirrorOf(work)
    } finally {
      Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, species)
    }

    await expect(mirror).rejects.toBeInstanceOf(StorageException)
  })
})
