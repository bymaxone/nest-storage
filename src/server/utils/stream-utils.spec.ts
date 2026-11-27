/**
 * @fileoverview Unit tests for the polymorphic-body stream utilities: type
 * guards, sizing, the memory-bounded peek/tee, and the buffer-to-stream adapter.
 * @layer server/utils
 */
import { EventEmitter, once } from 'node:events'
import { PassThrough, Readable, Stream } from 'node:stream'
import {
  destroyStream,
  readStreamUpTo,
  bufferToReadable,
  getBodySize,
  isBufferLike,
  isReadable,
  peekFirstBytes,
  readStream,
  toUploadBody,
  asReadable,
} from './stream-utils'

/** Drains a stream to a string, normalizing string/Buffer chunks. */
async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString()
}

/** Drains a stream and returns the total number of bytes seen. */
async function drainBytes(stream: NodeJS.ReadableStream): Promise<number> {
  let total = 0
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.byteLength
  }
  return total
}

/** Yields to the event loop so pending stream 'data' handlers can run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Polls until a predicate holds or a bounded number of ticks elapses. */
async function waitUntil(predicate: () => boolean, maxTicks = 100): Promise<void> {
  for (let attempt = 0; attempt < maxTicks && !predicate(); attempt += 1) {
    await tick()
  }
}

describe('readStream', () => {
  it('reads Buffer chunks to one Buffer', async () => {
    // The whole stream, in order.
    expect(
      (await readStream(Readable.from([Buffer.from('ab'), Buffer.from('cd')]))).toString(),
    ).toBe('abcd')
  })

  it('reads string chunks as their bytes', async () => {
    // A stream in string mode delivers text; it is returned as UTF-8 bytes.
    const stream = Readable.from([Buffer.from('é')])
    stream.setEncoding('utf8')

    expect(await readStream(stream)).toEqual(Buffer.from('é', 'utf8'))
  })

  it('returns an empty Buffer for an empty stream', async () => {
    // Nothing delivered is zero bytes, not an error.
    expect((await readStream(Readable.from([]))).length).toBe(0)
  })

  it('refuses a changed runtime before it reads the first chunk from the source', async () => {
    // The root is checked when the read starts, so a key planted on Object.prototype stops the call
    // before the source is asked for anything, instead of after it has been read.
    const root = Object.prototype as unknown as Record<string, unknown>
    let reads = 0
    const source = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          reads += 1
          return Promise.resolve({ done: true, value: undefined })
        },
      }),
    } as unknown as NodeJS.ReadableStream
    root.plantedBeforeRead = true
    try {
      await expect(readStream(source)).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
      })
    } finally {
      Reflect.deleteProperty(root, 'plantedBeforeRead')
    }
    expect(reads).toBe(0)
  })

  it('refuses a changed runtime before it takes the iterator, so a source that opens a resource there is not opened', async () => {
    // A source may open a resource in Symbol.asyncIterator() and release it in next() or return(); taking the
    // iterator first and refusing afterwards would leave that resource opened and never released.
    const root = Object.prototype as unknown as Record<string, unknown>
    let opened = 0
    const source = {
      [Symbol.asyncIterator]: () => {
        opened += 1
        return { next: () => Promise.resolve({ done: true, value: undefined }) }
      },
    } as unknown as NodeJS.ReadableStream
    root.plantedBeforeIterator = true
    try {
      await expect(readStream(source)).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
      })
    } finally {
      Reflect.deleteProperty(root, 'plantedBeforeIterator')
    }
    expect(opened).toBe(0)
  })

  it('opens the source once and reads it to its end on a clean runtime', async () => {
    // The order pin: the check does not stop a clean read from taking the iterator exactly once.
    let opened = 0
    const source = {
      [Symbol.asyncIterator]: () => {
        opened += 1
        return { next: () => Promise.resolve({ done: true, value: undefined }) }
      },
    } as unknown as NodeJS.ReadableStream
    expect((await readStream(source)).length).toBe(0)
    expect(opened).toBe(1)
  })

  it('refuses a changed runtime before peek attaches to the source, so the source is not read', async () => {
    // peek wires a data listener on the caller's stream, which starts it flowing; the check must come first.
    const root = Object.prototype as unknown as Record<string, unknown>
    let reads = 0
    const source = new Readable({
      read() {
        reads += 1
        this.push(null)
      },
    })
    root.plantedBeforePeek = true
    try {
      await expect(peekFirstBytes(source, 1)).rejects.toMatchObject({
        response: { error: { code: 'STORAGE_VALIDATION_FAILED' } },
      })
    } finally {
      Reflect.deleteProperty(root, 'plantedBeforePeek')
    }
    // The source is read on a later tick if a listener was attached, so let one pass before counting.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(reads).toBe(0)
  })
})

describe('toUploadBody', () => {
  it('turns a string into its UTF-8 bytes', () => {
    // Characters are not bytes: "é" is two.
    expect(toUploadBody('é')).toEqual(Buffer.from([0xc3, 0xa9]))
  })

  it('turns an ArrayBuffer into a Buffer of the same bytes', () => {
    // Untyped callers can hand over a raw ArrayBuffer.
    expect(toUploadBody(new Uint8Array([1, 2, 3]).buffer)).toEqual(Buffer.from([1, 2, 3]))
  })

  it('turns a non-Uint8 view into a Buffer over exactly its own bytes', () => {
    // A Uint16Array of two elements is four bytes, and an offset view must not leak its neighbours.
    const whole = new Uint16Array([1, 2, 3])
    const view = new Uint16Array(whole.buffer, 2, 2)

    expect(toUploadBody(view)).toEqual(Buffer.from(whole.buffer, 2, 4))
  })

  it.each([
    ['a Blob', new Blob(['abc'])],
    ['an array of chunks', [Buffer.from('a'), Buffer.from('b')]],
    ['a plain object', { data: 'abc' }],
    ['a number', 42],
    [
      'an async iterable that is not a stream',
      {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: true, value: undefined }),
        }),
      },
    ],
  ])(
    'refuses %s with STORAGE_VALIDATION_FAILED naming the body, not a multipart failure',
    (_label, value) => {
      let thrown: unknown
      try {
        toUploadBody(value)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400 })
      expect((thrown as { getResponse(): unknown }).getResponse()).toMatchObject({
        error: {
          details: {
            field: 'body',
            reason: 'body must be a Buffer, Uint8Array, ArrayBuffer, string or readable stream',
          },
        },
      })
    },
  )

  it.each([
    ['an object with only a pipe function', { pipe: (): void => undefined }],
    ['a WHATWG ReadableStream', new ReadableStream()],
    [
      'an object with pipe and on but no once',
      { pipe: (): void => undefined, on: (): void => undefined },
    ],
    [
      'an object with pipe and once but no on',
      { pipe: (): void => undefined, once: (): void => undefined },
    ],
    [
      'an object with pipe, once, pause and resume but no on',
      {
        pipe: (): void => undefined,
        once: (): void => undefined,
        pause: (): void => undefined,
        resume: (): void => undefined,
      },
    ],
    [
      'an object with pipe, on, pause and resume but no once',
      {
        pipe: (): void => undefined,
        on: (): void => undefined,
        pause: (): void => undefined,
        resume: (): void => undefined,
      },
    ],
    [
      'an object with pipe, on and once but no pause or resume',
      { pipe: (): void => undefined, on: (): void => undefined, once: (): void => undefined },
    ],
    [
      'an object with pipe, on, once and pause but no resume',
      {
        pipe: (): void => undefined,
        on: (): void => undefined,
        once: (): void => undefined,
        pause: (): void => undefined,
      },
    ],
    [
      'an object with pipe, on, once and resume but no pause',
      {
        pipe: (): void => undefined,
        on: (): void => undefined,
        once: (): void => undefined,
        resume: (): void => undefined,
      },
    ],
  ])(
    'refuses %s with STORAGE_VALIDATION_FAILED naming the body, not a raw TypeError',
    (_label, value) => {
      let thrown: unknown
      try {
        toUploadBody(value)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ code: 'STORAGE_VALIDATION_FAILED', status: 400 })
      expect((thrown as { getResponse(): unknown }).getResponse()).toMatchObject({
        error: { details: { field: 'body' } },
      })
    },
  )

  it('leaves a Buffer, a Uint8Array and a stream as they are', () => {
    // The accepted shapes pass through by identity.
    const buffer = Buffer.from('a')
    const bytes = new Uint8Array(1)
    const stream = new PassThrough()

    expect(toUploadBody(buffer)).toBe(buffer)
    expect(toUploadBody(bytes)).toBe(bytes)
    expect(toUploadBody(stream)).toBe(stream)
  })
})

describe('stream-utils', () => {
  describe('type guards', () => {
    it('isReadable is true for a stream and false for buffer-like bodies', () => {
      // Streams are the complement of buffer-like bodies.
      expect(isReadable(Readable.from(['x']))).toBe(true)
      expect(isReadable(Buffer.from('x'))).toBe(false)
      expect(isReadable(new Uint8Array([1]))).toBe(false)
    })

    it('isBufferLike is true for Buffer/Uint8Array and false for a stream', () => {
      // Buffer extends Uint8Array; streams are not instances of it.
      expect(isBufferLike(Buffer.from('x'))).toBe(true)
      expect(isBufferLike(new Uint8Array([1]))).toBe(true)
      expect(isBufferLike(Readable.from(['x']))).toBe(false)
    })
  })

  describe('getBodySize', () => {
    it('returns the byte length for buffer-like bodies and undefined for streams', () => {
      // Known size for buffers, unknown for streams.
      expect(getBodySize(Buffer.from('abc'))).toBe(3)
      expect(getBodySize(new Uint8Array([1, 2]))).toBe(2)
      expect(getBodySize(Readable.from(['x']))).toBeUndefined()
    })
  })

  describe('peekFirstBytes — buffer bodies', () => {
    it('slices a Buffer zero-copy and returns the original body', async () => {
      // The Buffer branch returns a subarray view and the same reference.
      const buf = Buffer.from('hello')
      const { head, replacementBody } = await peekFirstBytes(buf, 3)
      expect(head.toString()).toBe('hel')
      expect(replacementBody).toBe(buf)
    })

    it('converts a Uint8Array to a Buffer for the replacement body', async () => {
      // The non-Buffer buffer-like branch wraps via Buffer.from.
      const u8 = new Uint8Array([104, 101, 108, 108, 111])
      const { head, replacementBody } = await peekFirstBytes(u8, 2)
      expect(head.toString()).toBe('he')
      expect(Buffer.isBuffer(replacementBody)).toBe(true)
    })
  })

  describe('peekFirstBytes — streams', () => {
    it('peeks the head and yields the full body from the replacement (single chunk reaching maxBytes)', async () => {
      // Peek closes once maxBytes is reached; the replacement still streams it all.
      const { head, replacementBody } = await peekFirstBytes(
        Readable.from([Buffer.from('hello')]),
        3,
      )
      expect(head.toString()).toBe('hel')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('hello')
    })

    it('returns the whole body as the head when shorter than maxBytes', async () => {
      // The under-maxBytes path never closes the peek early.
      const { head, replacementBody } = await peekFirstBytes(Readable.from([Buffer.from('hi')]), 10)
      expect(head.toString()).toBe('hi')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('hi')
    })

    it('collects every chunk of a body shorter than maxBytes that arrives in separate reads', async () => {
      /* The head collector must keep reading after its first chunk: with the chunks written apart it answers 'ab', not 'a'. */
      const source = new Readable({ read() {} })
      const peeking = peekFirstBytes(source, 10)
      source.push(Buffer.from('a'))
      await tick()
      source.push(Buffer.from('b'))
      await tick()
      source.push(null)

      const { head, replacementBody } = await peeking

      expect(head.toString()).toBe('ab')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('ab')
    })

    it('stops peeking after maxBytes but keeps streaming later chunks', async () => {
      // A later chunk is skipped on the peek side but still reaches the upload side.
      const { head, replacementBody } = await peekFirstBytes(
        Readable.from([Buffer.from('ab'), Buffer.from('cd')]),
        2,
      )
      expect(head.toString()).toBe('ab')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('abcd')
    })

    it('peeks exactly maxBytes across chunks, not the whole crossing chunk', async () => {
      // First chunk 'a' (1 byte) is under maxBytes; the second chunk 'bcd' crosses the
      // boundary. The head must be exactly the first 3 bytes ('abc'), proving the peek
      // slice width is `maxBytes - peeked` (2 here) and that peeking stops AT maxBytes —
      // not `maxBytes + peeked` (which would grab 'abcd') and not after the first chunk.
      const { head, replacementBody } = await peekFirstBytes(
        Readable.from([Buffer.from('a'), Buffer.from('bcd')]),
        3,
      )
      expect(head.toString()).toBe('abc')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('abcd')
    })

    it('handles a stream that emits strings', async () => {
      // String chunks are normalized to Buffers in the tee.
      const { head, replacementBody } = await peekFirstBytes(Readable.from(['hello']), 3)
      expect(head.toString()).toBe('hel')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('hello')
    })

    it('pauses a fast source instead of buffering the whole body before a consumer attaches', async () => {
      // With no consumer on the replacement body yet, a source that races ahead
      // must be paused by upload-side backpressure — only a bounded amount is
      // buffered, never the entire payload.
      const source = new PassThrough()
      const peekPromise = peekFirstBytes(source, 4)
      source.write(Buffer.from('head'))
      const { head, replacementBody } = await peekPromise
      expect(head.toString()).toBe('head')
      const uploadPT = replacementBody as PassThrough

      const chunkCount = 64
      const chunk = Buffer.alloc(64 * 1024, 1)
      for (let i = 0; i < chunkCount; i += 1) {
        source.write(chunk)
      }

      await waitUntil(() => source.isPaused())
      expect(source.isPaused()).toBe(true)
      expect(uploadPT.writableLength).toBeLessThan(chunkCount * chunk.byteLength)

      // Attaching a consumer relieves backpressure (drain → resume); the full
      // body still streams through. Completing at all proves the source was
      // resumed — otherwise the drain would hang on the paused source.
      source.end()
      const bytes = await drainBytes(replacementBody as NodeJS.ReadableStream)
      expect(bytes).toBe('head'.length + chunkCount * chunk.byteLength)
    })

    it('reads a head larger than the upload buffer, without pausing before the head is complete', async () => {
      // Nothing reads the upload side until the head resolves, so a pause before then would never end.
      const chunk = Buffer.alloc(64 * 1024, 7)
      const source = new PassThrough()
      const peeking = peekFirstBytes(source, 8 * chunk.byteLength)
      for (let i = 0; i < 8; i += 1) source.write(chunk)

      const { head, replacementBody } = await peeking
      expect(head.byteLength).toBe(8 * chunk.byteLength)

      source.end()
      expect(await drainBytes(replacementBody as NodeJS.ReadableStream)).toBe(8 * chunk.byteLength)
    })

    it('propagates a source error to the replacement body', async () => {
      // The peek resolves first; a later source error surfaces on the upload side.
      const source = new PassThrough()
      const promise = peekFirstBytes(source, 3)
      source.write(Buffer.from('hello'))
      const { replacementBody } = await promise
      const collected = collect(replacementBody as NodeJS.ReadableStream)
      source.destroy(new Error('boom'))
      await expect(collected).rejects.toThrow('boom')
    })

    it('keeps a source error from crashing the process when nothing reads the replacement', async () => {
      // A validator can reject, or the request can fail, before anyone attaches to the replacement.
      const source = new PassThrough()
      const promise = peekFirstBytes(source, 3)
      source.write(Buffer.from('hello'))
      const { replacementBody } = await promise
      const crashed = jest.fn()
      process.once('uncaughtException', crashed)

      source.destroy(new Error('boom'))
      await new Promise((resolve) => setImmediate(resolve))
      process.removeListener('uncaughtException', crashed)

      expect(crashed).not.toHaveBeenCalled()
      expect((replacementBody as PassThrough).destroyed).toBe(true)
    })
  })

  describe('bufferToReadable', () => {
    it('wraps a Buffer as a readable stream', async () => {
      // The Buffer branch streams the bytes back.
      expect(await collect(bufferToReadable(Buffer.from('data')))).toBe('data')
    })

    it('wraps a Uint8Array as a readable stream', async () => {
      // The non-Buffer branch converts then streams.
      expect(await collect(bufferToReadable(new Uint8Array([104, 105])))).toBe('hi')
    })
  })

  describe('peekFirstBytes releases the original stream', () => {
    it('destroys the source when the consumer destroys the replacement before the end', async () => {
      const source = new Readable({ read() {} })
      source.push(Buffer.from('%PDF-1.7 and a long body'))

      const { replacementBody } = await peekFirstBytes(source, 4)
      ;(replacementBody as Readable).destroy()
      await new Promise((resolve) => setImmediate(resolve))

      expect(source.destroyed).toBe(true)
    })

    it('leaves a source without destroy() alone when the replacement is destroyed early', async () => {
      // NodeJS.ReadableStream does not promise destroy(); a minimal stream must not throw from the close handler.
      const emitter = new EventEmitter()
      const minimal = Object.assign(emitter, { pause: () => minimal, resume: () => minimal })
      const heading = peekFirstBytes(minimal as unknown as NodeJS.ReadableStream, 4)
      minimal.emit('data', Buffer.from('%PDF-1.7 and a long body'))
      const { replacementBody } = await heading

      ;(replacementBody as Readable).destroy()
      await new Promise((resolve) => setImmediate(resolve))

      expect((replacementBody as Readable).destroyed).toBe(true)
    })

    it('does not destroy a source that has already ended', async () => {
      // autoDestroy is off so any destroy() call comes from the tee, not from the stream itself.
      const source = new Readable({
        autoDestroy: false,
        read() {
          this.push(Buffer.from('abcdefgh'))
          this.push(null)
        },
      })
      const destroy = jest.spyOn(source, 'destroy')

      const { replacementBody } = await peekFirstBytes(source, 4)
      const text = await collect(replacementBody as NodeJS.ReadableStream)
      await new Promise((resolve) => setImmediate(resolve))

      expect(text).toBe('abcdefgh')
      expect(destroy).not.toHaveBeenCalled()
    })
  })

  describe('destroyStream', () => {
    it('does not treat a stream that answers destroy() with itself as something to wait on', () => {
      let thenReads = 0
      const stream = {
        destroy(): unknown {
          return this
        },
        get then(): undefined {
          thenReads += 1
          return undefined
        },
      }
      destroyStream(stream as unknown as NodeJS.ReadableStream)
      expect(thenReads).toBe(0)
    })

    it('handles the rejection of a destroy that returns a promise, for every caller', async () => {
      const seen: unknown[] = []
      const prior = process.listeners('unhandledRejection')
      process.removeAllListeners('unhandledRejection')
      process.on('unhandledRejection', (reason) => seen.push(reason))
      try {
        destroyStream({
          destroy: (): Promise<never> => Promise.reject(new Error('from destroy')),
        } as unknown as NodeJS.ReadableStream)
        await new Promise((resolve) => setImmediate(resolve))
      } finally {
        process.removeAllListeners('unhandledRejection')
        for (const listener of prior) process.on('unhandledRejection', listener)
      }
      expect(seen).toEqual([])
    })

    it('keeps an error from crashing the process when the stream cleanup fails', async () => {
      // A stream's own _destroy can fail even when destroy() was called without an error.
      const failingCleanup = new Readable({
        read() {},
        destroy(_err, callback) {
          callback(new Error('resource close failed'))
        },
      })
      const crashed = jest.fn()
      process.once('uncaughtException', crashed)

      destroyStream(failingCleanup)
      await new Promise((resolve) => setImmediate(resolve))
      process.removeListener('uncaughtException', crashed)

      expect(crashed).not.toHaveBeenCalled()
      expect(failingCleanup.destroyed).toBe(true)
    })

    it('destroys without an error, so nothing is forwarded to a stream wrapping the source', async () => {
      // A wrapper that re-emits its source's error (the SDK's does) must receive none.
      const source = new Readable({ read() {} })
      const forwarded = jest.fn()
      source.on('error', forwarded)

      destroyStream(source)
      await new Promise((resolve) => setImmediate(resolve))

      expect(source.destroyed).toBe(true)
      expect(forwarded).not.toHaveBeenCalled()
    })

    it('ignores an absent body and a body that cannot be destroyed', () => {
      expect(() => {
        destroyStream(undefined as unknown as NodeJS.ReadableStream)
        destroyStream(Buffer.from('abc') as unknown as NodeJS.ReadableStream)
      }).not.toThrow()
    })
  })

  describe('readStreamUpTo', () => {
    it('returns the whole body when it fits', async () => {
      const body = await readStreamUpTo(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 10)

      expect(body?.toString()).toBe('abcd')
    })

    it('accepts a body exactly as long as the limit', async () => {
      const body = await readStreamUpTo(Readable.from([Buffer.from('abcd')]), 4)

      expect(body?.toString()).toBe('abcd')
    })

    it('returns undefined and destroys the stream at the first chunk past the limit', async () => {
      const source = new Readable({ read() {} })
      source.push(Buffer.alloc(3))
      source.push(Buffer.alloc(3))
      source.push(Buffer.alloc(3))

      const body = await readStreamUpTo(source, 5)

      expect(body).toBeUndefined()
      expect(source.destroyed).toBe(true)
    })

    it('accepts string chunks', async () => {
      const source = new Readable({
        encoding: 'utf8',
        read() {
          this.push('ab')
          this.push('c')
          this.push(null)
        },
      })

      const body = await readStreamUpTo(source, 10)

      expect(body?.toString()).toBe('abc')
    })

    it('returns an empty buffer for an empty stream', async () => {
      const body = await readStreamUpTo(Readable.from([]), 10)

      expect(body?.length).toBe(0)
    })

    it('rejects when the stream errors', async () => {
      const source = new Readable({ read() {} })
      source.destroy(new Error('boom'))

      await expect(readStreamUpTo(source, 10)).rejects.toThrow('boom')
    })

    describe('releasing an iterator by hand', () => {
      /** A source whose iterator hands out `chunks`, then ends, and counts the calls of `return`. */
      function counted(chunks: Buffer[]): {
        source: NodeJS.ReadableStream
        released: () => number
      } {
        let released = 0
        let at = 0
        const iterator = {
          next: (): Promise<IteratorResult<Buffer>> =>
            Promise.resolve(
              at < chunks.length
                ? { done: false, value: chunks[at++]! }
                : { done: true, value: undefined },
            ),
          return: (): Promise<IteratorResult<Buffer>> => {
            released += 1
            return Promise.resolve({ done: true, value: undefined })
          },
        }
        const source = {
          [Symbol.asyncIterator]: () => iterator,
        } as unknown as NodeJS.ReadableStream
        return { source, released: () => released }
      }

      it('does not release an iterator that ended by itself', async () => {
        /* Releasing is for a read that stopped early; a finished iterator is left alone. */
        const { source, released } = counted([Buffer.from('ab')])

        const body = await readStreamUpTo(source, 10)

        expect(body?.toString()).toBe('ab')
        expect(released()).toBe(0)
      })

      it('releases an iterator once when the read stops early', async () => {
        const { source, released } = counted([Buffer.from('abc'), Buffer.from('def')])

        const body = await readStreamUpTo(source, 4)

        expect(body).toBeUndefined()
        expect(released()).toBe(1)
      })
    })
  })
})

describe('asReadable', () => {
  const oldStyle = (extra: object = {}): Stream =>
    Object.assign(new Stream(), {
      readable: true,
      pause: () => undefined,
      resume: () => undefined,
      ...extra,
    })

  // A stream with the flag is what the library already follows: it is not wrapped.
  it('returns a stream with a destroyed flag as it was given', () => {
    for (const source of [new Readable({ read: () => undefined }), new PassThrough()]) {
      expect(asReadable(source)).toBe(source)
    }
  })

  // The wrapper is a Node Readable that delivers what the old-style source delivers.
  it('reads an old-style source through a Readable, resuming it', async () => {
    const source: Stream = oldStyle({
      resume: () => {
        source.emit('data', Buffer.from('abc'))
        source.emit('end')
      },
    })

    const wrapper = asReadable(source as unknown as NodeJS.ReadableStream)

    expect(wrapper).toBeInstanceOf(Readable)
    await expect(readStream(wrapper)).resolves.toEqual(Buffer.from('abc'))
  })

  // An upload that gives the wrapper up releases the caller's source; a finished one is left alone.
  it('destroys the source only when the adapter is given up before the end', async () => {
    const destroy = jest.fn()
    const given = asReadable(
      oldStyle({ destroy }) as unknown as NodeJS.ReadableStream,
    ) as unknown as Readable
    given.destroy()
    await once(given, 'close')
    expect(destroy).toHaveBeenCalledTimes(1)

    destroy.mockClear()
    const source = oldStyle({ destroy })
    const finished = asReadable(source as unknown as NodeJS.ReadableStream) as unknown as Readable
    finished.resume()
    source.emit('end')
    await once(finished, 'close')
    expect(destroy).not.toHaveBeenCalled()
  })

  // Bytes still held when a close follows the end are delivered, not dropped.
  it('keeps what it holds when the source closes after its end', async () => {
    const source = oldStyle()
    const adapter = asReadable(source as unknown as NodeJS.ReadableStream)
    source.emit('data', Buffer.from('abc'))
    source.emit('end')
    source.emit('close')

    await expect(readStream(adapter)).resolves.toEqual(Buffer.from('abc'))
  })

  // An error, and a close with no end, both fail the read, and neither raises an error of the
  // wrapper's own: releasing a source can emit either, with nothing listening for it.
  it.each([
    ['close', undefined],
    ['error', new Error('boom')],
  ])('fails the read on a %s before the end, raising no error', async (event, given) => {
    const source = oldStyle()
    const adapter = asReadable(source as unknown as NodeJS.ReadableStream)
    const raised = jest.fn()
    adapter.on('error', raised)
    const read = readStream(adapter)
    source.emit(event, given)

    await expect(read).rejects.toBeDefined()
    expect(raised).not.toHaveBeenCalled()
  })

  // A full buffer pauses the source, and reading resumes it.
  it('pauses the source on backpressure and resumes it when read', async () => {
    const pause = jest.fn()
    const resume = jest.fn()
    const source = oldStyle({ pause, resume })
    const adapter = asReadable(source as unknown as NodeJS.ReadableStream) as unknown as Readable
    expect(resume).toHaveBeenCalledTimes(1)

    source.emit('data', Buffer.alloc(adapter.readableHighWaterMark))
    expect(pause).toHaveBeenCalledTimes(1)
    adapter.on('data', () => undefined)
    await new Promise((resolve) => setImmediate(resolve))

    expect(resume).toHaveBeenCalledTimes(2)
  })
})
