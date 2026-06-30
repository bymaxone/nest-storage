/**
 * @fileoverview Unit tests for the polymorphic-body stream utilities: type
 * guards, sizing, the memory-bounded peek/tee, and the buffer-to-stream adapter.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'
import {
  bufferToReadable,
  getBodySize,
  isBufferLike,
  isReadable,
  peekFirstBytes,
} from './stream-utils'

/** Drains a stream to a string, normalizing string/Buffer chunks. */
async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString()
}

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
      const { head, replacementBody } = await peekFirstBytes(
        Readable.from([Buffer.from('hi')]),
        10,
      )
      expect(head.toString()).toBe('hi')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('hi')
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

    it('handles a stream that emits strings', async () => {
      // String chunks are normalized to Buffers in the tee.
      const { head, replacementBody } = await peekFirstBytes(Readable.from(['hello']), 3)
      expect(head.toString()).toBe('hel')
      expect(await collect(replacementBody as NodeJS.ReadableStream)).toBe('hello')
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
})
