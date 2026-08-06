/**
 * @fileoverview Helpers for the polymorphic upload body (`Buffer`,
 * `NodeJS.ReadableStream`, or `Uint8Array`): type guards, best-effort sizing,
 * a non-consuming first-bytes peek for content validators, and a buffer-to-
 * stream adapter. Hand-rolled with `node:stream` to keep zero runtime deps.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'

/** Every shape accepted as an upload body. */
export type UploadBody = Buffer | NodeJS.ReadableStream | Uint8Array

/**
 * Narrows a body to a `Buffer` or `Uint8Array` (a `Buffer` is a `Uint8Array`).
 *
 * @param body - The polymorphic upload body.
 * @returns `true` for buffer-like bodies.
 */
export function isBufferLike(body: UploadBody): body is Buffer | Uint8Array {
  return body instanceof Uint8Array
}

/**
 * Narrows a body to a Node readable stream. Within {@link UploadBody}, anything
 * that is not buffer-like is a stream, so the check is the exact complement of
 * {@link isBufferLike}.
 *
 * @param body - The polymorphic upload body.
 * @returns `true` for stream bodies.
 */
export function isReadable(body: UploadBody): body is NodeJS.ReadableStream {
  return !isBufferLike(body)
}

/**
 * Best-effort body size: the byte length for buffer-like bodies, `undefined`
 * for streams whose length is not known up front.
 *
 * @param body - The polymorphic upload body.
 * @returns The size in bytes, or `undefined` for streams.
 */
export function getBodySize(body: UploadBody): number | undefined {
  return isBufferLike(body) ? body.byteLength : undefined
}

/**
 * Reads the first `maxBytes` of a body without consuming it for the actual
 * upload. Buffer-like bodies are sliced zero-copy. Streams are teed through two
 * `PassThrough`s — one feeds the peek, the other becomes the `replacementBody`.
 *
 * The caller MUST upload using the returned `replacementBody`; if it is dropped,
 * the source stream stalls on backpressure once the peek side fills.
 *
 * @param body - The polymorphic upload body.
 * @param maxBytes - The maximum number of leading bytes to read.
 * @returns The peeked head and the body to use for the upload.
 */
export async function peekFirstBytes(
  body: UploadBody,
  maxBytes: number,
): Promise<{ head: Buffer; replacementBody: UploadBody }> {
  if (isBufferLike(body)) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    return { head: buf.subarray(0, maxBytes), replacementBody: buf }
  }
  return teeAndPeek(body, maxBytes)
}

/**
 * Tees a source stream: the peek side receives at most `maxBytes`, the upload
 * side receives the full stream.
 *
 * The upload consumer only attaches after the peek resolves, so once the peek
 * side is closed the source's flowing output would have nowhere to drain. To
 * keep memory bounded — rather than buffering the entire body — the source is
 * paused whenever the upload transform signals backpressure and resumed on its
 * `drain`; before the peek closes, buffering is inherently capped near
 * `maxBytes`.
 */
async function teeAndPeek(
  source: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ head: Buffer; replacementBody: UploadBody }> {
  const peekPT = new PassThrough()
  const uploadPT = new PassThrough()
  let peeked = 0
  let isPeekClosed = false
  const closePeek = (): void => {
    // Stryker disable next-line ConditionalExpression: the `isPeekClosed` flag is still set inside the block, and calling `peekPT.end()` more than once on a PassThrough is a harmless no-op — dropping this idempotency guard changes nothing observable.
    if (!isPeekClosed) {
      isPeekClosed = true
      peekPT.end()
    }
  }
  source.on('data', (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    if (peeked < maxBytes) {
      const slice = buf.subarray(0, maxBytes - peeked)
      peekPT.write(slice)
      peeked += slice.byteLength
      if (peeked >= maxBytes) {
        closePeek()
      }
    }
    const hasCapacity = uploadPT.write(buf)
    if (!hasCapacity && isPeekClosed) {
      source.pause()
      uploadPT.once('drain', () => source.resume())
    }
  })
  source.on('end', () => {
    closePeek()
    uploadPT.end()
  })
  source.on('error', (err: Error) => {
    // End the peek side gracefully so the head resolves with whatever arrived,
    // and surface the failure on the upload side for the consumer to handle.
    closePeek()
    uploadPT.destroy(err)
  })
  const head = await collectStream(peekPT)
  return { head, replacementBody: uploadPT }
}

/** Concatenates every chunk a (size-bounded) stream emits into one Buffer. */
async function collectStream(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Wraps a buffer-like value as a `Readable` for APIs that require a stream.
 *
 * @param buf - The buffer or byte array to wrap.
 * @returns A readable stream emitting the buffer's bytes.
 */
export function bufferToReadable(buf: Buffer | Uint8Array): Readable {
  return Readable.from(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
}
