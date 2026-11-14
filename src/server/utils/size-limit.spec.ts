/**
 * @fileoverview The size guard: bytes up to the limit pass unchanged, the limit itself is allowed,
 * one byte more fails the read and releases the source.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'
import { SizeLimitError, withSizeLimit } from './size-limit'

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
