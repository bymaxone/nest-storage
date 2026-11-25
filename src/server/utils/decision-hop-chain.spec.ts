/**
 * @fileoverview A value an async function returns, a stream an iterator reads and a promise a health check
 * follows each reach the decision through the library's own reads: a `then` on a carrier above the value, a host
 * that acts while a stream is read, and a replaced or throwing `Promise[Symbol.species]` cannot change what the
 * library answers.
 * @layer server/utils
 */
import { EventEmitter } from 'node:events'
import { PassThrough, Readable, Stream } from 'node:stream'
import { StorageHealthIndicator } from '../../observability/storage-health'
import { StorageService } from '../services/storage.service'
import { ValidationService } from '../services/validation.service'
import { FileScannerService } from '../services/file-scanner.service'
import { assertCleanRoot, INTRINSIC_PROMISE, isRootRefusal, settles } from './prototype-guard'
import { readStream, readStreamUpTo } from './stream-utils'

const proto: object = Object.getPrototypeOf(Promise.resolve()) as object
const realConstructor = Object.getOwnPropertyDescriptor(proto, 'constructor')!
const typedArray: object = Object.getPrototypeOf(Uint8Array.prototype) as object

/** The carriers a returned Buffer or stream reads `then` through, one per prototype above them. */
const CARRIERS: readonly [string, () => object][] = [
  ['Buffer.prototype', (): object => Buffer.prototype as object],
  ['Uint8Array.prototype', (): object => Uint8Array.prototype],
  ['%TypedArray%.prototype', () => typedArray],
  ['Readable.prototype', (): object => Readable.prototype],
  ['Stream.prototype', (): object => Stream.prototype],
  ['EventEmitter.prototype', (): object => EventEmitter.prototype],
]

/** The module options an upload through a fake client needs. */
const UPLOAD_OPTIONS = {
  bucket: 'b',
  publicBaseUrl: 'https://cdn.example',
  multipart: { thresholdBytes: 1e9 },
}

/** Leaves a `then` that stays on `target` and hands out `forged` as the answer of whatever it is read from. */
function plantThen(target: object, forged: unknown): void {
  Reflect.defineProperty(target, 'then', {
    configurable: true,
    get() {
      return (resolve: (value: unknown) => void) => {
        resolve(forged)
      }
    },
  })
}

afterEach(() => {
  for (const [, target] of CARRIERS) Reflect.deleteProperty(target(), 'then')
  Reflect.deleteProperty(Object.prototype, 'then')
})

describe('a returned value that carries a `then`', () => {
  it.each(CARRIERS.slice(0, 3))(
    'is refused when %s holds a persistent `then`, for every Buffer the library hands on',
    async (_name, target) => {
      const source = new Readable({
        read() {
          this.push(Buffer.from('real'))
          this.push(null)
        },
      })
      plantThen(target(), 'forged')

      const outcome = await readStream(source).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )

      expect('value' in outcome ? outcome.value : undefined).toBeUndefined()
      expect(isRootRefusal('error' in outcome ? outcome.error : undefined)).toBe(true)
    },
  )

  it.each(CARRIERS)(
    'is refused by `settles` when %s holds a `then` (a getter included)',
    (_name, target) => {
      plantThen(target(), 'forged')
      const value =
        _name.startsWith('Readable') || _name.startsWith('Stream') || _name.startsWith('Event')
          ? new PassThrough()
          : Buffer.from('real')

      expect(() => settles(value)).toThrow()
      try {
        settles(value)
      } catch (error) {
        expect(isRootRefusal(error)).toBe(true)
      }
    },
  )

  it('is refused when the value itself carries an own `then`, and passes a value that does not', () => {
    const own = Buffer.from('real')
    Object.defineProperty(own, 'then', { value: () => undefined, configurable: true })

    expect(() => settles(own)).toThrow()
    expect(settles(Buffer.from('real')).toString()).toBe('real')
    expect(settles(null)).toBeNull()
    expect(settles(7)).toBe(7)
  })

  it('refuses a chain that never ends, and a `then` deeper than the walk reads', () => {
    const endless: object = new Proxy(
      {},
      {
        getPrototypeOf: () => endless,
        getOwnPropertyDescriptor: () => undefined,
      },
    )
    let deep: object = { then: () => undefined }
    for (let level = 0; level < 70; level += 1) deep = Object.create(deep) as object

    expect(() => settles(endless)).toThrow()
    expect(() => settles(deep)).toThrow()
  })

  it('refuses a value whose prototype read plants a `then` on the root', () => {
    const value = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          Object.defineProperty(Object.prototype, 'then', {
            configurable: true,
            get() {
              Reflect.deleteProperty(Object.prototype, 'then')
              return (resolve: (answer: unknown) => void) => {
                resolve('forged')
              }
            },
          })
          return undefined
        },
        getPrototypeOf: () => null,
      },
    )

    let refused: unknown
    try {
      settles(value)
    } catch (error) {
      refused = error
    }
    const left = Reflect.has(Object.prototype, 'then')
    Reflect.deleteProperty(Object.prototype, 'then')

    expect(left).toBe(true)
    expect(isRootRefusal(refused)).toBe(true)
  })

  it('refuses a Proxy anywhere above the value, whose trap would answer a `then` the walk did not see', () => {
    const forged = new Proxy(Object.prototype, {
      get(target, key, receiver) {
        return key === 'then'
          ? (resolve: (value: unknown) => void) => {
              resolve('forged')
            }
          : (Reflect.get(target, key, receiver) as unknown)
      },
    })
    const value = Object.create(forged) as object

    let refused: unknown
    try {
      settles(value)
    } catch (error) {
      refused = error
    }

    expect(isRootRefusal(refused)).toBe(true)
  })

  it('refuses every use once the prototype of a guarded built-in was pointed elsewhere', () => {
    const original = Object.getPrototypeOf(typedArray) as object
    Object.setPrototypeOf(typedArray, new Proxy(Object.prototype, {}))
    let refused: unknown
    try {
      assertCleanRoot()
    } catch (error) {
      refused = error
    } finally {
      Object.setPrototypeOf(typedArray, original)
    }

    expect(isRootRefusal(refused)).toBe(true)
  })

  it('refuses every use once `Promise[Symbol.species]` was replaced after the library loaded', () => {
    const real = Object.getOwnPropertyDescriptor(INTRINSIC_PROMISE, Symbol.species)!
    Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, {
      configurable: true,
      get: () => Promise,
    })
    let refused: unknown
    try {
      assertCleanRoot()
    } catch (error) {
      refused = error
    } finally {
      Reflect.defineProperty(INTRINSIC_PROMISE, Symbol.species, real)
    }

    expect(isRootRefusal(refused)).toBe(true)
  })

  it('never hands a validator the bytes a `then` planted on Buffer.prototype answers with', async () => {
    const seen: string[] = []
    const options = { ...UPLOAD_OPTIONS, validation: {} }
    const magic = {
      name: 'magic',
      validate: async ({ readBytes }: { readBytes: (n: number) => Promise<Buffer> }) => {
        plantThen(Buffer.prototype as object, '%PDF')
        seen.push(String(await readBytes(4)))
        return { ok: true }
      },
    }
    const service = new ValidationService(options as never, [magic as never])

    const outcome = await service
      .validate({
        key: 'k',
        contentType: 'text/plain',
        size: 12,
        body: Readable.from([Buffer.from('MZ-malicious')]),
      })
      .then(
        () => 'accepted',
        (error: unknown) => (isRootRefusal(error) ? 'refused' : 'failed'),
      )

    expect(outcome).toBe('refused')
    expect(seen).toEqual([])
  })
})

describe('a stream the library reads', () => {
  /** Leaves a constructor accessor that forges the next bare await of a promise, then restores itself. */
  function plantStepForgery(): void {
    const real = Object.getOwnPropertyDescriptor(proto, 'constructor')!
    Reflect.defineProperty(proto, 'constructor', {
      configurable: true,
      get(this: object) {
        const site = (new Error().stack ?? '').split('\n')[2] ?? ''
        if (!/stream-utils|validation\.service|settle-or-cut|storage\.service/.test(site)) {
          return real.value as unknown
        }
        Reflect.defineProperty(proto, 'constructor', real)
        Reflect.defineProperty(this, 'then', {
          configurable: true,
          value(this: object, resolve: (value: unknown) => void) {
            Reflect.deleteProperty(this, 'then')
            resolve({ value: Buffer.from('CLEAN'), done: false })
          },
        })
        return function Forged() {
          // Not the engine's constructor.
        }
      },
    })
  }

  it('never lets a listener the host attaches to the body forge the head a validator peeks at', async () => {
    const options = { ...UPLOAD_OPTIONS, validation: {} }
    const peeked: string[] = []
    const stored: string[] = []
    const magic = {
      name: 'magic',
      validate: async ({ readBytes }: { readBytes: (n: number) => Promise<Buffer> }) => {
        const head = String(await readBytes(5))
        peeked.push(head)
        return head.includes('EVIL') ? { ok: false, reason: 'bad magic' } : { ok: true }
      },
    }
    const service = new StorageService(
      options as never,
      {
        isConfigured: () => true,
        getClient: () => ({
          send: async (command: { input: { Body: AsyncIterable<Buffer> } }) => {
            const chunks: Buffer[] = []
            for await (const chunk of command.input.Body) chunks.push(Buffer.from(chunk))
            stored.push(Buffer.concat(chunks).toString())
            return { ETag: '"e"' }
          },
        }),
      } as never,
      { normalize: (key: string) => key, stripPrefix: (key: string) => key } as never,
      {} as never,
      new ValidationService(options as never, [magic as never]),
      { isEnabled: () => false, getMode: () => 'disabled' } as never,
      undefined,
    )
    const body = Readable.from([Buffer.from('EVIL!')])
    body.on('newListener', (event) => {
      if (event === 'error' && peeked.length === 0) plantStepForgery()
    })

    try {
      await service
        .upload({ body, size: 5, contentType: 'text/plain', key: 'k' })
        .catch(() => undefined)
    } finally {
      Reflect.defineProperty(proto, 'constructor', realConstructor)
    }

    expect(stored.every((value) => peeked.includes(value))).toBe(true)
  })

  it('still reads a clean stream to its end, and stops and releases one that is over the limit', async () => {
    const destroyed = jest.fn()
    const long = new Readable({
      read() {
        this.push(Buffer.from('abcdef'))
        this.push(null)
      },
    })
    long.on('close', destroyed)

    expect((await readStream(Readable.from([Buffer.from('ab'), 'cd']))).toString()).toBe('abcd')
    expect(await readStreamUpTo(long, 3)).toBeUndefined()
    await new Promise((resolve) => setImmediate(resolve))
    expect(destroyed).toHaveBeenCalledTimes(1)
  })

  it('does not call `return` on an iterator that ended, and surfaces a stream that failed', async () => {
    await expect(
      readStream(
        new Readable({
          read() {
            this.destroy(new Error('stream failed'))
          },
        }),
      ),
    ).rejects.toThrow('stream failed')
  })
})

describe('the readiness of a bucket that is down', () => {
  const unavailable = Object.assign(new Error('Service Unavailable'), {
    name: 'ServiceUnavailable',
    $metadata: { httpStatusCode: 503 },
  })

  /** A health indicator over a service whose bucket answers 503. */
  function downIndicator(): StorageHealthIndicator {
    const storage = new StorageService(
      { bucket: 'b', multipart: { thresholdBytes: 1e9 } } as never,
      {
        isConfigured: () => true,
        getClient: () => ({ send: () => Promise.reject(unavailable) }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    )
    return new StorageHealthIndicator(storage)
  }

  const promiseConstructor = proto.constructor as PromiseConstructor
  const species = Object.getOwnPropertyDescriptor(promiseConstructor, Symbol.species)!

  afterEach(() => {
    Reflect.defineProperty(promiseConstructor, Symbol.species, species)
  })

  it("stays `down` when `Promise[Symbol.species]` answers with a constructor of the host's own", async () => {
    Reflect.defineProperty(promiseConstructor, Symbol.species, {
      configurable: true,
      get() {
        if (!(new Error().stack ?? '').includes('storage-health')) return promiseConstructor
        return function Forge(executor: (...args: unknown[]) => void): Promise<string> {
          executor(
            () => undefined,
            () => undefined,
          )
          return new promiseConstructor<string>((resolve) => {
            resolve('up')
          })
        }
      },
    })

    await expect(downIndicator().check()).resolves.toEqual({ status: 'down' })
  })

  it('stays `down`, with nothing left unhandled, when `Promise[Symbol.species]` throws', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    Reflect.defineProperty(promiseConstructor, Symbol.species, {
      configurable: true,
      get() {
        if (!(new Error().stack ?? '').includes('storage-health')) return promiseConstructor
        throw new Error('species')
      },
    })

    try {
      await expect(downIndicator().check()).resolves.toEqual({ status: 'down' })
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', listener)
    }

    expect(unhandled).toEqual([])
  })

  it('keeps its cache by the clock read at load: a Date.now the host moved or broke afterwards is not consulted', async () => {
    const checkBucket = jest.fn(() => Promise.resolve())
    const indicator = new StorageHealthIndicator({ checkBucket } as never)
    const first = await indicator.check()
    const now = jest.spyOn(Date, 'now').mockImplementation(() => Date.parse('2099-01-01'))
    let moved: unknown
    let broken: unknown
    try {
      moved = await indicator.check()
      now.mockImplementation(() => {
        throw new Error('clock')
      })
      broken = await indicator.check()
    } finally {
      now.mockRestore()
    }

    expect([first, moved, broken]).toEqual([{ status: 'up' }, { status: 'up' }, { status: 'up' }])
    expect(checkBucket).toHaveBeenCalledTimes(1)
  })

  it('answers the probe, not a hang, when the signal it listens to throws as it is detached', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const detach = jest
      .spyOn(EventTarget.prototype, 'removeEventListener')
      .mockImplementation(() => {
        throw new Error('host removeEventListener')
      })
    const indicator = new StorageHealthIndicator({ checkBucket: () => Promise.resolve() } as never)
    let answer: unknown = 'pending'

    try {
      void indicator.check(new AbortController().signal).then((result) => {
        answer = result
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      detach.mockRestore()
      process.off('unhandledRejection', listener)
    }

    expect(answer).toEqual({ status: 'up' })
    expect(unhandled).toEqual([])
  })

  it('answers `down` for a probe it cannot follow (a frozen promise), not an error', async () => {
    const storage = {
      checkBucket: () => Object.freeze(Promise.resolve()),
    }

    await expect(new StorageHealthIndicator(storage as never).check()).resolves.toEqual({
      status: 'down',
    })
  })
})

describe('a Buffer upload with a pre-upload scan', () => {
  it.each(CARRIERS.slice(0, 3))(
    'stores the bytes it scanned when %s holds a persistent `then`',
    async (_name, target) => {
      const scanned: string[] = []
      const stored: string[] = []
      const options = {
        bucket: 'b',
        publicBaseUrl: 'https://cdn.example',
        multipart: { thresholdBytes: 1e9 },
        validation: { maxSizeBytes: 1000 },
        scanner: { mode: 'pre-upload', timeoutMs: 1000 },
      }
      const scanner = new FileScannerService(
        options as never,
        {
          scan: (input: { body?: Buffer | NodeJS.ReadableStream }) => {
            scanned.push(Buffer.isBuffer(input.body) ? input.body.toString() : 'stream')
            return Promise.resolve({ status: 'clean', engine: 'av' })
          },
        },
        undefined,
      )
      const service = new StorageService(
        options as never,
        {
          isConfigured: () => true,
          getClient: () => ({
            send: (command: { input: { Body: unknown } }) => {
              stored.push(String(command.input.Body))
              return Promise.resolve({ ETag: '"e"' })
            },
          }),
        } as never,
        { normalize: (key: string) => key, stripPrefix: (key: string) => key } as never,
        {} as never,
        {
          checkHeaders: () => undefined,
          validate: (input: { body: unknown }) => Promise.resolve({ body: input.body }),
        } as never,
        scanner,
        undefined,
      )
      plantThen(target(), Buffer.from('EVIL!'))

      await service
        .upload({ body: Buffer.from('CLEAN'), contentType: 'text/plain', key: 'k' })
        .catch(() => undefined)

      expect(stored.every((body) => scanned.includes(body))).toBe(true)
    },
  )
})
