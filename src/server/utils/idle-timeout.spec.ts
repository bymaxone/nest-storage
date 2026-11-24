/**
 * @fileoverview The idle guard: a silent source is cut off, a live one is not, and the wrapper
 * never leaves an unheard `'error'` behind.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { guardIdleBody, SourceIdleError, withIdleTimeout } from './idle-timeout'

async function collect(stream: AsyncIterable<unknown>): Promise<string> {
  const parts: Buffer[] = []
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(parts).toString()
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('withIdleTimeout', () => {
  it('yields the source chunks unchanged', async () => {
    // A source that ends on its own passes through whole.
    const source = Readable.from([Buffer.from('ab'), Buffer.from('cd')])

    expect(await collect(withIdleTimeout(source, 1000))).toBe('abcd')
  })

  it('fails the read with SourceIdleError when the source goes silent, and destroys it', async () => {
    const source = new Readable({ read() {} })
    source.push(Buffer.from('head'))

    const failure = collect(withIdleTimeout(source, 50))

    await expect(failure).rejects.toBeInstanceOf(SourceIdleError)
    await expect(failure).rejects.toMatchObject({
      idleMs: 50,
      name: 'SourceIdleError',
      message: 'The upload source delivered no bytes for 50 ms',
    })
    expect(source.destroyed).toBe(true)
  })

  it('restarts the clock on every chunk', async () => {
    // Four chunks 40 ms apart: 160 ms in total, more than the 100 ms limit, but no silence reaches it.
    let sent = 0
    const source = new Readable({
      read() {
        if (sent >= 4) {
          this.push(null)
          return
        }
        sent += 1
        setTimeout(() => this.push(Buffer.from('x')), 40)
      },
    })

    expect(await collect(withIdleTimeout(source, 100))).toBe('xxxx')
  })

  it('does not run the clock while nothing is asking for data', async () => {
    // Nobody reads the wrapper for longer than the limit; the first read must still succeed.
    const source = new Readable({ read() {} })
    const wrapper = withIdleTimeout(source, 60)
    await new Promise((resolve) => setTimeout(resolve, 150))
    source.push(Buffer.from('late'))
    source.push(null)

    expect(await collect(wrapper)).toBe('late')
  })

  it('does not run the clock for read-ahead while the consumer is paused', async () => {
    // The source delivers its second chunk 100 ms in, longer than the 50 ms limit, but the consumer
    // pauses for 150 ms after the first chunk, so by the time it asks again the chunk is waiting.
    const source = new Readable({ read() {} })
    source.push(Buffer.from('one'))
    setTimeout(() => source.push(Buffer.from('two')), 100)
    setTimeout(() => source.push(null), 120)
    const seen: string[] = []

    for await (const chunk of withIdleTimeout(source, 50)) {
      seen.push(String(chunk))
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    expect(seen.join('')).toBe('onetwo')
  })

  it('hands the uploader bytes even when the source emits strings', async () => {
    // A source that emits strings (this one is object-mode) must still reach the uploader as bytes.
    const source = Readable.from(['ab', 'cd'])
    const chunks: unknown[] = []

    for await (const chunk of withIdleTimeout(source, 1000)) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((chunk) => Buffer.isBuffer(chunk))).toBe(true)
    expect(Buffer.concat(chunks as Buffer[]).toString()).toBe('abcd')
  })

  it('passes a source error through to the reader', async () => {
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy(new Error('boom'))

    await expect(failure).rejects.toThrow('boom')
  })

  it('hands on an error from another realm as it is, with its code', async () => {
    // `instanceof Error` is false for it, and re-wrapping would drop the code a classifier reads.
    const foreign = runInNewContext(
      "Object.assign(new Error('aborted'), { code: 'ECONNRESET' })",
    ) as Error
    expect(foreign instanceof Error).toBe(false)
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy(foreign)

    await expect(failure).rejects.toBe(foreign)
  })

  it('hands on a DOMException as it is, with its name', async () => {
    // It is an Error, but its toString tag is another one: an abort or timeout signal's reason.
    const reason = new DOMException('timed out', 'TimeoutError')
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy(reason)

    await expect(failure).rejects.toBe(reason)
  })

  it.each([
    ['an object with a message and no name', { message: 'only a message' }],
    ['an object with a name and no message', { name: 'OnlyAName' }],
    ['an object whose name is not text', { name: 1, message: 'a message' }],
    ['an object whose message is not text', { name: 'Named', message: 2 }],
  ])('turns %s into an error, as it is not one', async (_label, value) => {
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy(value as unknown as Error)

    const reason: unknown = await failure.catch((err: unknown) => err)

    expect(reason).not.toBe(value)
    expect(reason).toBeInstanceOf(Error)
  })

  it.each([
    ['null', null as unknown as Error, 'null'],
    ['undefined', undefined as unknown as Error, 'undefined'],
  ])('turns a source that rejects with %s into an error', async (_label, value, description) => {
    const source = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(value) }),
    } as unknown as NodeJS.ReadableStream

    const reason: unknown = await collect(withIdleTimeout(source, 1000)).catch(
      (err: unknown) => err,
    )

    expect(reason).toBeInstanceOf(Error)
    expect((reason as Error).message).toBe(description)
  })

  it('settles, with an error, when the rejection value throws on being inspected', async () => {
    // Reading `name` of this value throws. The check that tells an error from anything else must not
    // let that throw escape: it would leave the wrapped read pending for good, with its timer cleared.
    const hostile = {
      get name(): string {
        throw new Error('name getter')
      },
    } as unknown as Error
    const source = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(hostile) }),
    } as unknown as NodeJS.ReadableStream
    const stalled = Symbol('stalled')

    const reason: unknown = await Promise.race([
      collect(withIdleTimeout(source, 1000)).catch((err: unknown) => err),
      new Promise((resolve) =>
        setTimeout(() => {
          resolve(stalled)
        }, 400),
      ),
    ])

    expect(reason).not.toBe(stalled)
    expect(reason).toBeInstanceOf(Error)
  })

  it('turns a rejection that is not an error into one, with its description', async () => {
    const source = new PassThrough()
    const failure = collect(withIdleTimeout(source, 1000))
    source.destroy('plain text' as unknown as Error)

    await expect(failure).rejects.toThrow('plain text')
  })

  it('keeps an error from crashing the process when nothing reads the wrapper', async () => {
    // The uploader may already be gone; the wrapper still must not raise an unheard 'error'.
    const source = new PassThrough()
    const wrapper = withIdleTimeout(source, 30)
    const crashed = jest.fn()
    process.once('uncaughtException', crashed)

    wrapper.resume()
    await new Promise((resolve) => setTimeout(resolve, 120))
    process.removeListener('uncaughtException', crashed)

    expect(crashed).not.toHaveBeenCalled()
    expect(wrapper.destroyed).toBe(true)
    expect(source.destroyed).toBe(true)
  })

  it('releases the source when the wrapper is destroyed early, without an error', async () => {
    const source = new Readable({ read() {} })
    source.push(Buffer.from('first'))
    const wrapper = withIdleTimeout(source, 5000)
    const forwarded = jest.fn()
    source.on('error', forwarded)
    for await (const _chunk of wrapper) {
      break
    }
    await tick()

    expect(wrapper.destroyed).toBe(true)
    expect(source.destroyed).toBe(true)
    expect(forwarded).not.toHaveBeenCalled()
  })

  it('leaves no timer running once the source ends', async () => {
    const clear = jest.spyOn(global, 'clearTimeout')

    await collect(withIdleTimeout(Readable.from([Buffer.from('a')]), 5000))

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})

/** An old-style stream: it has the events and `pipe` of the stream contract but is not a `Readable`. */
class LegacyStream extends EventEmitter implements NodeJS.ReadableStream {
  readable = true
  read(): string {
    return ''
  }
  setEncoding(): this {
    return this
  }
  pause(): this {
    return this
  }
  resume(): this {
    return this
  }
  isPaused(): boolean {
    return false
  }
  pipe<T extends NodeJS.WritableStream>(destination: T): T {
    return destination
  }
  unpipe(): this {
    return this
  }
  unshift(): void {
    // An old-style stream has nothing to put back.
  }
  wrap(): this {
    return this
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Buffer> {
    return (async function* () {
      await Promise.resolve()
      yield Buffer.alloc(0)
    })()
  }
}

describe('guardIdleBody', () => {
  it('returns a buffer or a Uint8Array as is', () => {
    const buffer = Buffer.from('abc')
    const bytes = new Uint8Array([1])

    expect(guardIdleBody(buffer, 10)).toBe(buffer)
    expect(guardIdleBody(bytes, 10)).toBe(bytes)
  })

  it('returns the stream itself when the guard is off', () => {
    const source = new Readable({ read() {} })

    expect(guardIdleBody(source, 0)).toBe(source)
  })

  it('adapts a stream that is not a Readable when the guard is off, and passes its data on', async () => {
    // An old-style stream has `pipe` and events but is not a Readable; the uploader needs a Readable.
    const legacy = new LegacyStream()

    const adapted = guardIdleBody(legacy, 0) as Readable
    const received: Buffer[] = []
    adapted.on('data', (chunk: Buffer) => received.push(chunk))
    const ended = new Promise<void>((resolve) => adapted.on('end', resolve))
    legacy.emit('data', Buffer.from('abc'))
    legacy.emit('end')
    await ended

    expect(adapted).toBeInstanceOf(Readable)
    expect(Buffer.concat(received).toString()).toBe('abc')
  })

  it('refuses with the library code and the host error as the cause when examining the stream throws', () => {
    // A Proxy runs host code on `instanceof`; what it throws must not reach the caller raw.
    const failure = new Error('SENTINEL trap ran')
    const hostile = new Proxy(new LegacyStream(), {
      getPrototypeOf: () => {
        throw failure
      },
    })
    let thrown: unknown
    try {
      guardIdleBody(hostile, 0)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      response: {
        error: {
          code: 'STORAGE_VALIDATION_FAILED',
          details: { reason: 'the stream body could not be read' },
        },
      },
      cause: failure,
    })
    expect(JSON.stringify((thrown as { response: unknown }).response)).not.toContain('SENTINEL')
  })

  it('destroys the stream with the mapped error when the caller supplied a mapping', async () => {
    // A source that fails is reported through the caller's own mapping, not as the raw failure.
    const source = new Readable({ read() {} })
    setImmediate(() => source.destroy(new Error('raw')))
    const wrapper = withIdleTimeout(source, 1000, (error) => new Error(`mapped:${error.message}`))
    wrapper.resume()
    const failure = await new Promise<Error>((resolve) => wrapper.once('error', resolve))

    expect(failure.message).toBe('mapped:raw')
  })

  it('ignores a step that arrives after the idle error has ended the stream', async () => {
    // The source answers once the clock has already cut the wait, so the late bytes go nowhere.
    let answer: (step: IteratorResult<Buffer>) => void = () => undefined
    const source = new Readable({ read() {} })
    source[Symbol.asyncIterator] = (() => ({
      next: () =>
        new Promise<IteratorResult<Buffer>>((resolve) => {
          answer = resolve
        }),
    })) as unknown as (typeof source)[typeof Symbol.asyncIterator]
    const received: string[] = []
    const wrapper = withIdleTimeout(source, 10)
    wrapper.on('data', (chunk: Buffer) => received.push(chunk.toString()))
    const failure = await new Promise<unknown>((resolve) => wrapper.once('error', resolve))
    answer({ done: false, value: Buffer.from('late') })
    await tick()

    expect(failure).toBeInstanceOf(SourceIdleError)
    expect(received).toEqual([])
  })

  it('hands on no bytes and fails the stream when a built-in was replaced while the step was in flight', async () => {
    // The runtime is checked right before the bytes are pushed, so a replaced built-in is refused there.
    const original = Buffer.isBuffer
    const source = Readable.from(
      (async function* (): AsyncGenerator<Buffer> {
        await tick()
        Buffer.isBuffer = ((value: unknown) => original(value)) as typeof Buffer.isBuffer
        yield Buffer.from('late')
      })(),
    )
    const received: string[] = []
    let failure: unknown
    try {
      const wrapper = withIdleTimeout(source, 1000)
      wrapper.on('data', (chunk: Buffer) => received.push(chunk.toString()))
      await new Promise<void>((resolve) => {
        wrapper.once('error', (error: unknown) => {
          failure = error
        })
        wrapper.once('close', resolve)
      })
    } finally {
      Buffer.isBuffer = original
    }

    expect(received).toEqual([])
    expect(failure).toBeInstanceOf(Error)
  })

  it('hands on the bytes the source delivered when Promise.prototype.then was replaced to rewrite them', async () => {
    // A host replaces `then` after load so that a step read through it carries other bytes: the wrapper follows
    // the source with the `then` captured at load, so the rewrite never runs.
    const source = Readable.from([Buffer.from('validated-clean')])
    const original = Promise.prototype.then
    const rewrite = (value: unknown): unknown => {
      const step = value as { done?: boolean; value?: unknown } | undefined
      return step?.done === false && Buffer.isBuffer(step.value)
        ? { done: false, value: Buffer.from('MZ-malicious') }
        : value
    }
    Promise.prototype.then = function replaced(
      this: Promise<unknown>,
      onFulfilled?: unknown,
      onRejected?: unknown,
    ) {
      const wrapped =
        typeof onFulfilled === 'function'
          ? (value: unknown): unknown => (onFulfilled as (v: unknown) => unknown)(rewrite(value))
          : onFulfilled
      return original.call(this, wrapped as undefined, onRejected as undefined)
    } as typeof Promise.prototype.then
    const received: string[] = []
    let failure: unknown
    try {
      const wrapper = withIdleTimeout(source, 1000)
      wrapper.on('data', (chunk: Buffer) => received.push(chunk.toString()))
      await new Promise<void>((resolve) => {
        wrapper.once('error', (error: unknown) => {
          failure = error
        })
        wrapper.once('close', resolve)
      })
    } finally {
      Promise.prototype.then = original
    }

    expect(received).toEqual(['validated-clean'])
    expect(failure).toBeUndefined()
  })

  it('wraps a stream when the guard is on', () => {
    const source = new Readable({ read() {} })

    const guarded = guardIdleBody(source, 100)

    expect(guarded).not.toBe(source)
    expect(guarded).toBeInstanceOf(Readable)
    source.destroy()
  })
})

describe('withIdleTimeout and a step that settles twice or after the cut', () => {
  function sourceAnswering(next: () => unknown): Readable {
    const source = new Readable({ read() {} })
    source[Symbol.asyncIterator] = (() => ({
      next,
    })) as unknown as (typeof source)[typeof Symbol.asyncIterator]
    return source
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('hands on no bytes that arrive after the idle error', async () => {
    // The wait ended with the idle error, so a step that comes after it is not pushed into the wrapper.
    const push = jest.spyOn(Readable.prototype, 'push')
    let answer: (step: IteratorResult<Buffer>) => void = () => undefined
    const wrapper = withIdleTimeout(
      sourceAnswering(
        () =>
          new Promise<IteratorResult<Buffer>>((resolve) => {
            answer = resolve
          }),
      ),
      10,
    )
    wrapper.on('data', () => undefined)
    await new Promise<unknown>((resolve) => wrapper.once('error', resolve))
    answer({ done: false, value: Buffer.from('late') })
    await tick()

    expect(push).not.toHaveBeenCalledWith(Buffer.from('late'))
  })

  it('maps the failure once when the source fails after the idle error', async () => {
    // The second failure is the source's own, arriving late: it is not reported through the mapping again.
    let fail: (reason: unknown) => void = () => undefined
    const toError = jest.fn((error: Error) => error)
    const wrapper = withIdleTimeout(
      sourceAnswering(
        () =>
          new Promise<IteratorResult<Buffer>>((_resolve, reject) => {
            fail = reject
          }),
      ),
      10,
      toError,
    )
    wrapper.on('data', () => undefined)
    await new Promise<unknown>((resolve) => wrapper.once('error', resolve))
    fail(new Error('late failure'))
    await tick()

    expect(toError).toHaveBeenCalledTimes(1)
  })

  it('ignores a failure that follows the bytes of the same step', async () => {
    // A thenable that answers with a value and then with a failure is honoured once, by its first answer.
    const toError = jest.fn((error: Error) => error)
    const received: string[] = []
    let asked = 0
    const wrapper = withIdleTimeout(
      sourceAnswering(() => {
        asked += 1
        if (asked > 1) return new Promise<never>(() => undefined)
        return {
          then(
            onValue: (step: IteratorResult<Buffer>) => void,
            onError: (reason: unknown) => void,
          ) {
            onValue({ done: false, value: Buffer.from('first') })
            onError(new Error('second answer'))
          },
        }
      }),
      1000,
      toError,
    )
    wrapper.on('data', (chunk: Buffer) => received.push(chunk.toString()))
    wrapper.on('error', () => undefined)
    await tick()
    wrapper.destroy()

    expect(received).toEqual(['first'])
    expect(toError).not.toHaveBeenCalled()
  })

  it('ignores bytes that follow the failure of the same step', async () => {
    // The order is reversed: the failure comes first and ends the stream, so the bytes after it go nowhere.
    const push = jest.spyOn(Readable.prototype, 'push')
    const wrapper = withIdleTimeout(
      sourceAnswering(() => ({
        then(onValue: (step: IteratorResult<Buffer>) => void, onError: (reason: unknown) => void) {
          onError(new Error('first answer'))
          onValue({ done: false, value: Buffer.from('second') })
        },
      })),
      1000,
    )
    wrapper.on('data', () => undefined)
    const failure = await new Promise<unknown>((resolve) => wrapper.once('error', resolve))
    await tick()

    expect((failure as Error).message).toBe('first answer')
    expect(push).not.toHaveBeenCalledWith(Buffer.from('second'))
  })
})
