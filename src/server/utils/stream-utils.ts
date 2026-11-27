/**
 * @fileoverview Helpers for the polymorphic upload body (`Buffer`,
 * `NodeJS.ReadableStream`, or `Uint8Array`): type guards, best-effort sizing,
 * a non-consuming first-bytes peek for content validators, and a buffer-to-
 * stream adapter. Hand-rolled with `node:stream` to keep zero runtime deps.
 * @layer server/utils
 */
import { PassThrough, Readable } from 'node:stream'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { absorb } from './absorb'
import { stepOf, verdictOf } from './settle-or-cut'
import { assertCleanRoot, settles } from './prototype-guard'

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
  // The tee attaches a data listener to the caller's stream, which starts it flowing, so the root is checked first.
  assertCleanRoot()
  const failed = failedInPlaceOf(body)
  return failed
    ? settles({ head: Buffer.alloc(0), replacementBody: failed })
    : await verdictOf(teeAndPeek(body, maxBytes))
}

/**
 * Takes hold of a stream as an upload is handed it. One that already ended, failed or was destroyed
 * is replaced by a stream that has already failed. A live one is destroyed as soon as it reports an
 * error, so that a read which subscribes afterwards finds it failed instead of waiting for events
 * that are past.
 *
 * @param source - The caller's stream.
 * @returns The stream to upload: `source` itself, or the failed one in its place.
 */
export function holdSource(source: NodeJS.ReadableStream): NodeJS.ReadableStream {
  const failed = failedInPlaceOf(source)
  if (failed) {
    return failed
  }
  // Destroyed without an error, as `destroyStream` explains. One `NodeJS.ReadableStream` shape or
  // another may lack `once`; there is nothing to watch then.
  ;(source as Partial<Readable>).once?.('error', () => {
    destroyStream(source)
  })
  return source
}

/** The error Node reports for a stream that closed before its end. */
export function prematureClose(): Error {
  return Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
}

/**
 * A stream that has already failed, to stand for a source whose bytes are past: one that ended (they
 * went to whoever read it), failed or was destroyed. Its `'data'`, `'end'` and `'error'` are past or
 * will not come. It carries the source's own error when there is one. `undefined` for any other
 * source, one without these Node properties included.
 */
function failedInPlaceOf(source: NodeJS.ReadableStream): PassThrough | undefined {
  const { errored, destroyed, readableEnded } = source as Partial<Readable>
  if (!errored && !destroyed && !readableEnded) {
    return undefined
  }
  const replacement = new PassThrough()
  // No consumer may be attached yet (a validator can reject first); an unheard error would crash.
  replacement.once('error', () => undefined)
  replacement.destroy(errored ?? prematureClose())
  // Also hears a cleanup of the source that fails later.
  destroyStream(source)
  return replacement
}

/**
 * Destroys a stream when it can be destroyed. `NodeJS.ReadableStream` does not declare
 * `destroy()`, so a stream without it (a `Buffer`, for one) is left alone instead of throwing.
 *
 * The stream is destroyed without an error on purpose. The AWS SDK wraps a stream body in its own
 * Readable and forwards the source's `'error'` to it; once a request has failed nothing listens to
 * that wrapper, so an error given here would crash the process from a stream this library cannot
 * reach. A close carries no error to forward. Destroying can still emit `'error'` when the stream's
 * own cleanup fails, so a no-op listener is attached first; the caller is already being rejected,
 * or has already been answered.
 *
 * @param stream - The stream to release.
 */
export function destroyStream(stream: NodeJS.ReadableStream): void {
  // Untyped callers can pass an absent body; there is nothing to release then.
  const target = stream as Partial<Readable> | null | undefined
  if (!target) {
    return
  }
  target.once?.('error', () => undefined)
  const answered: unknown = target.destroy?.()
  // A host's own stream may answer with a promise. A Node stream answers with itself.
  if (answered !== target) {
    absorb(() => answered)
  }
}

/**
 * Destroys `source` when the consumer closes `replacement` before the source ended. A consumer
 * that gives up on the replacement (a size limit, a failed upload) must also release the original,
 * which would otherwise stay paused and open.
 */
function releaseSourceOnEarlyClose(
  source: NodeJS.ReadableStream,
  replacement: PassThrough,
  sourceEnded: () => boolean,
): void {
  replacement.once('close', () => {
    if (!sourceEnded()) {
      destroyStream(source)
    }
  })
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
    // Reached more than once; ending an ended PassThrough does nothing.
    isPeekClosed = true
    peekPT.end()
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
  let sourceEnded = false
  source.on('end', () => {
    sourceEnded = true
    closePeek()
    uploadPT.end()
  })
  releaseSourceOnEarlyClose(source, uploadPT, () => sourceEnded)
  source.on('error', (err: Error) => {
    // End the peek side gracefully so the head resolves with whatever arrived,
    // and surface the failure on the upload side for the consumer to handle.
    closePeek()
    // No consumer may be attached yet (a validator can reject first); an unheard error would crash.
    uploadPT.once('error', () => undefined)
    uploadPT.destroy(err)
  })
  // A `'data'` listener does not restart a source its caller had paused.
  source.resume()
  const head = await verdictOf(collectStream(peekPT))
  return { head, replacementBody: uploadPT }
}

/**
 * Reads a stream chunk by chunk without `for await`, whose awaits read `constructor` and `then` of every promise
 * the iterator returns: each `next()` goes through {@link stepOf} instead, which follows it with the captured
 * `then` and leaves the root scan to the {@link verdictOf} every caller wraps the whole read in. The stream is
 * released when `take` stops the read, and not when the stream itself failed or ended.
 *
 * @param source - The stream to read.
 * @param take - Receives each chunk; answers `false` to stop reading.
 */
async function eachChunk(
  source: NodeJS.ReadableStream,
  take: (chunk: unknown) => boolean,
): Promise<void> {
  // `stepOf` does not scan the root, so the source is opened, and asked for its first chunk, only on a clean one.
  assertCleanRoot()
  const iterator = (source as AsyncIterable<unknown>)[Symbol.asyncIterator]()
  let more = true
  while (more) {
    const step = await stepOf(iterator.next())
    more = step.done !== true && take(step.value)
    if (step.done !== true && !more) {
      await verdictOf(iterator.return?.())
    }
  }
}

/** Concatenates every chunk a (size-bounded) stream emits into one Buffer. */
async function collectStream(stream: PassThrough): Promise<Buffer> {
  const chunks: Buffer[] = []
  await verdictOf(
    eachChunk(stream, (chunk) => {
      chunks.push(chunk as Buffer)
      return true
    }),
  )
  return settles(Buffer.concat(chunks))
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

/**
 * Reads a stream into one `Buffer`, counting bytes as they arrive and stopping at
 * the first chunk that takes the total past `maxBytes`, so an oversized or endless
 * stream is never held in memory.
 *
 * @param source - The stream to drain.
 * @param maxBytes - The most bytes accepted.
 * @returns The whole body, or `undefined` when it is longer than `maxBytes` (the
 *   stream is destroyed in that case).
 */
export async function readStreamUpTo(
  source: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  let within = true as boolean
  await verdictOf(
    eachChunk(source, (chunk) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
      total += buf.byteLength
      within = total <= maxBytes
      chunks.push(buf)
      return within
    }),
  )
  return within ? settles(Buffer.concat(chunks)) : undefined
}

/**
 * Reads a stream to its end into one `Buffer`.
 *
 * @param source - The stream to drain.
 * @returns Every byte the stream delivered.
 */
export async function readStream(source: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  await verdictOf(
    eachChunk(source, (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
      return true
    }),
  )
  return settles(Buffer.concat(chunks))
}

/**
 * Brings a body that arrived untyped to one of the accepted shapes: a string becomes its UTF-8
 * bytes and an `ArrayBuffer` or other view becomes a `Buffer`, so the size that is checked and
 * the size that is sent are both a count of bytes. Accepted shapes pass through unchanged.
 *
 * @param body - The body as the caller passed it.
 * @returns The same body, or its `Buffer` form.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` naming `body` for anything else (a `Blob`, an array).
 */
export function toUploadBody(body: unknown): UploadBody {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8')
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body)
  }
  if (ArrayBuffer.isView(body) && !(body instanceof Uint8Array)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  }
  const stream = body as
    | { pipe?: unknown; on?: unknown; once?: unknown; pause?: unknown; resume?: unknown }
    | null
    | undefined
  // The surface this library drives: `pipe`, the event methods, and `pause`/`resume` for backpressure. An
  // object without them is not a stream, and one that merely looks like it would be waited on until the timeout.
  const readable =
    typeof stream?.pipe === 'function' &&
    typeof stream.on === 'function' &&
    typeof stream.once === 'function' &&
    typeof stream.pause === 'function' &&
    typeof stream.resume === 'function'
  if (!(body instanceof Uint8Array) && !readable) {
    // A Blob, an array of chunks or any other object is not a body the SDK can send; refusing it here gives
    // the caller a validation error instead of a failure that blames the multipart upload.
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      field: 'body',
      reason: 'body must be a Buffer, Uint8Array, ArrayBuffer, string or readable stream',
    })
  }
  return body as UploadBody
}
