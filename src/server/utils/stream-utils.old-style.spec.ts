/**
 * @fileoverview Tests for `asReadable`: an old-style stream, one with no boolean `destroyed`
 * property, read through a Node `Readable`.
 * @layer server/utils
 */
import { once } from 'node:events'
import { PassThrough, Readable, Stream } from 'node:stream'
import { asReadable, readStream } from './stream-utils'

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

  // Only a pause it made is undone: a read with no pause, before or after one, resumes nothing.
  it('resumes the source only after it paused it', async () => {
    const settle = (): Promise<unknown> => new Promise((resolve) => setImmediate(resolve))
    const open = (): { resume: jest.Mock; source: Stream; adapter: Readable } => {
      const resume = jest.fn()
      const source = oldStyle({ resume })
      const adapter = asReadable(source as unknown as NodeJS.ReadableStream) as unknown as Readable
      return { resume, source, adapter }
    }

    const flowing = open()
    flowing.adapter.on('data', () => undefined)
    await settle()
    flowing.source.emit('data', Buffer.from('a'))
    await settle()
    expect(flowing.resume).toHaveBeenCalledTimes(1)

    const held = open()
    held.source.emit('data', Buffer.alloc(held.adapter.readableHighWaterMark))
    held.adapter.on('data', () => undefined)
    await settle()
    expect(held.resume).toHaveBeenCalledTimes(2)
    held.source.emit('data', Buffer.from('b'))
    await settle()
    expect(held.resume).toHaveBeenCalledTimes(2)
  })
})
