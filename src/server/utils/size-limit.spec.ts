/**
 * @fileoverview The size guard: bytes up to the limit pass unchanged, the limit itself is allowed,
 * one byte more fails the read and releases the source.
 * @layer server/utils
 */
import { PassThrough, Readable, Transform } from 'node:stream'
import { SizeLimitError, SizeShortfallError, withExactSize, withSizeLimit } from './size-limit'
import { SOURCE_LOST } from './stream-utils'

async function collect(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const chunk of stream) {
    parts.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(parts)
}

describe('withSizeLimit', () => {
  it('passes a stream that stays under the limit through unchanged', async () => {
    // A body within the bound must reach the upload byte for byte.
    const guarded = withSizeLimit(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), 10, 'max')

    expect((await collect(guarded)).toString()).toBe('abcd')
  })

  it('allows a stream of exactly the limit', async () => {
    // The bound is "more than", so a body of the limit's own size is not refused.
    const guarded = withSizeLimit(Readable.from([Buffer.from('abcd')]), 4, 'max')

    expect((await collect(guarded)).toString()).toBe('abcd')
  })

  it('fails the read with SizeLimitError carrying the limit and kind, and destroys the source', async () => {
    // One byte past the limit ends the read, and the source is released so nothing more is pulled.
    const source = new PassThrough()
    const guarded = withSizeLimit(source, 4, 'declared')
    source.write(Buffer.from('abcde'))

    const error: unknown = await collect(guarded).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(SizeLimitError)
    expect(error).toMatchObject({ limitBytes: 4, kind: 'declared' })
    expect(source.destroyed).toBe(true)
  })

  it('names itself and states the limit in its message', () => {
    // A log line or a caller reading the error sees the limit; the name tells it from other read errors.
    const error = new SizeLimitError(4, 'max')

    expect(error.name).toBe('SizeLimitError')
    expect(error.message).toBe('The upload body is longer than 4 bytes')
  })

  it('counts a string chunk in bytes, not characters', async () => {
    // A source in string mode delivers text; three 3-byte characters are 9 bytes.
    const source = Readable.from(['€€€'])
    const guarded = withSizeLimit(source, 8, 'max')

    await expect(collect(guarded)).rejects.toBeInstanceOf(SizeLimitError)
  })

  it('destroys the guard when the source fails, without an unhandled error event', async () => {
    // A source error must reach the reader as a read error and not crash the process.
    const source = new PassThrough()
    const guarded = withSizeLimit(source, 100, 'max')
    const reading = collect(guarded).catch((err: unknown) => err)
    source.destroy(new Error('source failed'))

    expect(await reading).toMatchObject({ message: 'source failed' })
  })
})

describe('withExactSize', () => {
  /** Everything the guard emitted before it ended or failed, and how it ended. */
  async function drain(stream: Readable): Promise<{ bytes: string; error: unknown }> {
    const parts: Buffer[] = []
    let error: unknown
    try {
      for await (const chunk of stream) parts.push(Buffer.from(chunk as Buffer))
    } catch (err) {
      error = err
    }
    return { bytes: Buffer.concat(parts).toString(), error }
  }

  it('passes a body of exactly the declared size through, last byte included', async () => {
    const guarded = withExactSize(
      Readable.from([Buffer.from('ab'), Buffer.from('cd'), Buffer.from('e')]),
      5,
    )

    expect(await drain(guarded)).toEqual({ bytes: 'abcde', error: undefined })
  })

  it('passes an empty body declared as 0 bytes', async () => {
    expect(await drain(withExactSize(Readable.from([]), 0))).toEqual({
      bytes: '',
      error: undefined,
    })
  })

  it('accepts a source that sends strings', async () => {
    expect(await drain(withExactSize(Readable.from(['ab', 'c']), 3))).toEqual({
      bytes: 'abc',
      error: undefined,
    })
  })

  it('refuses a longer body with a SizeLimitError before the declared size is complete', async () => {
    // The provider stores an object once it has received `Content-Length` bytes, so the last byte is
    // held back until the source has ended: here it never is released, and the request stays incomplete.
    const guarded = withExactSize(
      Readable.from([Buffer.from('abcd'), Buffer.from('e'), Buffer.from('f')]),
      5,
    )

    const { bytes, error } = await drain(guarded)

    expect(error).toBeInstanceOf(SizeLimitError)
    expect(error).toMatchObject({ limitBytes: 5, kind: 'declared' })
    expect(bytes.length).toBeLessThan(5)
  })

  it('refuses a shorter body with a SizeShortfallError naming both sizes', async () => {
    const { error } = await drain(withExactSize(Readable.from([Buffer.from('abc')]), 5))

    expect(error).toBeInstanceOf(SizeShortfallError)
    expect(error).toMatchObject({ declaredBytes: 5, receivedBytes: 3, name: 'SizeShortfallError' })
    expect((error as Error).message).toBe('The upload body has 3 bytes, fewer than the 5 declared')
  })

  it('fails the guard with the error of the source and releases the source', async () => {
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)
    const outcome = drain(guarded)

    source.write('ab')
    source.destroy(new Error('disk gone'))

    expect((await outcome).error).toMatchObject({ message: 'disk gone' })
    expect(source.destroyed).toBe(true)
  })

  it('wraps a source error that is not an Error', async () => {
    const source = new PassThrough()
    const outcome = drain(withExactSize(source, 10))

    source.emit('error', 'plain text')

    expect((await outcome).error).toMatchObject({ message: 'plain text' })
  })

  it('closes quietly, with no error event, when the source is destroyed without one', async () => {
    // The library destroys the caller's stream without an error when an upload fails; the guard then
    // closes without one, so the SDK does not forward a premature-close error to its own wrappers.
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)
    const events: string[] = []
    guarded.on('error', () => events.push('error'))
    const closed = new Promise<void>((resolve) =>
      guarded.once('close', () => {
        events.push('close')
        resolve()
      }),
    )

    source.destroy()
    await closed

    expect(events).toEqual(['close'])
    expect(guarded.destroyed).toBe(true)
  })

  it.each([
    ['the source goes by itself', (s: PassThrough) => s.destroy(), 1],
    ['the consumer destroys the guard', (_s: PassThrough, g: Readable) => g.destroy(), 0],
    ['the source fails', (s: PassThrough) => s.destroy(new Error('source failed')), 0],
    ['the source ends', (s: PassThrough, g: Readable) => (g.resume(), s.end('0123456789')), 0],
  ])('says the source was lost only when %s', async (_how, break_, times) => {
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)
    guarded.on('error', () => undefined)
    const lost = jest.fn()
    guarded.on(SOURCE_LOST, lost)

    break_(source, guarded)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(lost).toHaveBeenCalledTimes(times)
  })

  it('keeps a source that ended and closed from counting as lost while its bytes are unread', async () => {
    // A closed source is destroyed too, and only its `'end'` tells it apart from one that was cut.
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)
    const lost = jest.fn()
    guarded.on(SOURCE_LOST, lost)
    const closed = new Promise((resolve) => source.once('close', resolve))

    source.end('0123456789')
    await closed

    expect(guarded.destroyed).toBe(false)
    expect(lost).not.toHaveBeenCalled()
    expect(await drain(guarded)).toEqual({ bytes: '0123456789', error: undefined })
  })

  it('releases the source when the consumer destroys the guard', async () => {
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)

    guarded.destroy()
    await new Promise((resolve) => setImmediate(resolve))

    expect(source.destroyed).toBe(true)
  })

  it('leaves no error event unhandled on the source or the guard once the consumer has gone', async () => {
    const source = new PassThrough()
    const guarded = withExactSize(source, 10)
    const escaped = jest.fn()
    process.once('uncaughtException', escaped)

    guarded.destroy(new Error('request timed out'))
    source.emit('error', new Error('late'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    process.removeListener('uncaughtException', escaped)
    expect(escaped).not.toHaveBeenCalled()
  })
})

describe('withExactSize on a source that had already failed', () => {
  // The assertion is on the guard's `error` event: a reading loop would report a premature close for a
  // guard that was destroyed quietly too. "Closed" is whether the source's `close` has fired by then.
  const lost = { message: 'Premature close', code: 'ERR_STREAM_PREMATURE_CLOSE' }
  const own = { message: 'source failed' }
  it.each([
    ['destroyed', (s: PassThrough) => s.destroy(), lost],
    ['destroyed with an error', (s: PassThrough) => s.destroy(new Error('source failed')), own],
    ['ended and destroyed unread', (s: PassThrough) => s.end('abc').destroy(), lost],
    ['written and destroyed unread', (s: PassThrough) => (s.write('abc'), s.destroy()), lost],
  ])('fails a source %s, closed or not yet', async (_how, break_, expected) => {
    for (const closed of [false, true]) {
      const source = new PassThrough()
      source.once('error', () => undefined)
      break_(source)
      if (closed) await new Promise((resolve) => setImmediate(resolve))
      const errors: unknown[] = []
      withExactSize(source, 500).on('error', (err) => errors.push(err))

      await new Promise((resolve) => setImmediate(resolve))

      expect(errors).toEqual([expect.objectContaining(expected)])
    }
  })

  it('reports the shortfall of a source drained and then destroyed', async () => {
    const source = new PassThrough()
    source.resume()
    source.end('abc')
    await new Promise((resolve) => source.once('end', resolve))
    source.destroy()
    const errors: unknown[] = []
    withExactSize(source, 500).on('error', (err) => errors.push(err))

    await new Promise((resolve) => setImmediate(resolve))

    expect(errors).toEqual([expect.any(SizeShortfallError)])
  })

  it('reports the shortfall of a source already read to its end', async () => {
    const source = Readable.from([Buffer.from('abc')])
    for await (const _chunk of source) {
      // Drained, so the source is destroyed with no error to report.
    }

    const read = (async () => {
      for await (const _chunk of withExactSize(source, 500)) {
        // Nothing is expected to arrive.
      }
    })()

    await expect(read).rejects.toBeInstanceOf(SizeShortfallError)
  })

  it('fails the read of a source that errored without being destroyed', async () => {
    const source = new Transform({
      autoDestroy: false,
      transform(_chunk, _encoding, callback) {
        callback(new Error('source failed'))
      },
    })
    source.once('error', () => undefined)
    source.write('x')
    await new Promise((resolve) => setImmediate(resolve))
    expect(source.destroyed).toBe(false)

    const read = (async () => {
      for await (const _chunk of withExactSize(source, 500)) {
        // Nothing is expected to arrive.
      }
    })()

    await expect(read).rejects.toMatchObject({ message: 'source failed' })
  })

  it.each([
    ['errored', new Error('source failed'), { message: 'source failed' }],
    ['destroyed', undefined, { code: 'ERR_STREAM_PREMATURE_CLOSE' }],
  ])(
    'fails the read of an already %s source with what ended it',
    async (_state, cause, expected) => {
      const source = new PassThrough()
      source.once('error', () => undefined)
      source.destroy(cause)
      await new Promise((resolve) => setImmediate(resolve))

      const read = (async () => {
        for await (const _chunk of withExactSize(source, 500)) {
          // Nothing is expected to arrive.
        }
      })()

      await expect(read).rejects.toMatchObject(expected)
    },
  )
})

describe('withSizeLimit on a source that had already failed', () => {
  // The same source states as for the exact-size guard, for a declared limit and for a bare maximum.
  const lost = { message: 'Premature close', code: 'ERR_STREAM_PREMATURE_CLOSE' }
  const own = { message: 'source failed' }
  const turn = (): Promise<unknown> => new Promise((resolve) => setImmediate(resolve))

  it.each([
    ['destroyed', (s: PassThrough) => s.destroy(), lost],
    ['destroyed with an error', (s: PassThrough) => s.destroy(new Error('source failed')), own],
    ['ended and destroyed unread', (s: PassThrough) => s.end('abc').destroy(), lost],
    ['written and destroyed unread', (s: PassThrough) => (s.write('abc'), s.destroy()), lost],
  ])('fails a source %s, closed or not yet', async (_how, break_, expected) => {
    for (const kind of ['declared', 'max'] as const) {
      for (const closed of [false, true]) {
        const source = new PassThrough()
        source.once('error', () => undefined)
        break_(source)
        if (closed) await turn()
        const errors: unknown[] = []
        withSizeLimit(source, 500, kind).on('error', (err) => errors.push(err))

        await turn()

        expect(errors).toEqual([expect.objectContaining(expected)])
      }
    }
  })

  it('takes a source drained and then destroyed as ended', async () => {
    const source = new PassThrough()
    source.resume()
    source.end('abc')
    await new Promise((resolve) => source.once('end', resolve))
    source.destroy()
    const errors: unknown[] = []
    const done: string[] = []
    withSizeLimit(source, 500, 'declared').on('error', (err) => errors.push(err))
    withSizeLimit(source, 500, 'max')
      .on('end', () => done.push('end'))
      .resume()

    await turn()
    await turn()

    expect(errors).toEqual([expect.any(SizeShortfallError)])
    expect(done).toEqual(['end'])
  })

  it('keeps the failure of a source destroyed unread from going unhandled when nobody reads the guard', async () => {
    const source = new PassThrough()
    source.end('abc')
    source.destroy()

    const guard = withSizeLimit(source, 500, 'declared')
    await new Promise((resolve) => setImmediate(resolve))

    expect(guard.errored).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
  })
})

describe('withSizeLimit on a source that reports its error after it was destroyed', () => {
  it.each(['declared', 'max'] as const)('hears the late error of a %s source', async (kind) => {
    const source = new Readable({
      read: () => undefined,
      destroy: (_error, callback) => {
        process.nextTick(callback, new Error('late'))
      },
    })
    source.destroy()
    const errors: unknown[] = []
    withSizeLimit(source, 500, kind).on('error', (err) => errors.push(err))

    await new Promise((resolve) => setImmediate(resolve))

    expect(errors).toEqual([expect.objectContaining({ code: 'ERR_STREAM_PREMATURE_CLOSE' })])
    expect(source.errored).toMatchObject({ message: 'late' })
  })
})
