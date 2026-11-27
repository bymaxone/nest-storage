/**
 * @fileoverview The size guard for a stream body: counts the bytes that pass and fails the read
 * the moment the count exceeds a limit, destroying the source so nothing more is pulled from it.
 * @layer server/utils
 */
import { Transform, pipeline, type Readable } from 'node:stream'
import { destroyStream } from './stream-utils'

/** Which bound a stream crossed: the configured maximum, or the size its caller declared. */
export type SizeLimitKind = 'max' | 'declared'

/** Raised, as the read error of the guarded stream, when more bytes arrive than the limit allows. */
export class SizeLimitError extends Error {
  constructor(
    readonly limitBytes: number,
    readonly kind: SizeLimitKind,
  ) {
    super(`The upload body is longer than ${String(limitBytes)} bytes`)
    this.name = 'SizeLimitError'
  }
}

/**
 * Wraps a stream so that reading more than `limitBytes` fails with {@link SizeLimitError}. Bytes
 * up to the limit pass through unchanged and the limit itself is allowed. On the failure, and on
 * any error of the source, the source is destroyed.
 *
 * @param source - The caller's stream.
 * @param limitBytes - The most bytes the stream may deliver.
 * @param kind - Which bound `limitBytes` is, carried on the error.
 * @returns A readable stream to upload instead of `source`.
 */
export function withSizeLimit(
  source: NodeJS.ReadableStream,
  limitBytes: number,
  kind: SizeLimitKind,
): Readable {
  let seen = 0
  const guard = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      seen += Buffer.byteLength(chunk)
      if (seen > limitBytes) {
        callback(new SizeLimitError(limitBytes, kind))
        return
      }
      callback(null, chunk)
    },
  })
  // `pipeline` destroys the source when the guard fails, and keeps an error on either side from
  // surfacing as an unhandled 'error' event.
  pipeline(source, guard, () => undefined)
  return guard
}

/** Raised, as the read error of the exact-size stream, when the source ends before its declared size. */
export class SizeShortfallError extends Error {
  constructor(
    readonly declaredBytes: number,
    readonly receivedBytes: number,
  ) {
    super(`The upload body has ${String(receivedBytes)} bytes, fewer than the ${String(declaredBytes)} declared`)
    this.name = 'SizeShortfallError'
  }
}

/** The error Node reports for a stream that closed before its end. */
function prematureClose(): Error {
  return Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
}

/**
 * Wraps a stream whose size the caller declared so that the provider is never handed an object of
 * another length. More than `declaredBytes` fails with {@link SizeLimitError} and fewer with
 * {@link SizeShortfallError}. The last byte is held back until the source has ended: the request
 * carries `Content-Length` set to the declared size, and a provider that has received that many
 * bytes stores the object whatever else the source still holds, so a body longer than declared is
 * refused before its final byte is sent and the provider is left with an incomplete request.
 *
 * @param source - The caller's stream.
 * @param declaredBytes - The size the caller declared.
 * @returns A readable stream to upload instead of `source`.
 */
export function withExactSize(source: NodeJS.ReadableStream, declaredBytes: number): Readable {
  let seen = 0
  let held: Buffer = Buffer.alloc(0)
  const guard = new Transform({
    // `decodeStrings` is on, so a chunk that arrives as a string has already become a `Buffer`.
    transform(bytes: Buffer, _encoding, callback) {
      seen += bytes.byteLength
      if (seen > declaredBytes) {
        callback(new SizeLimitError(declaredBytes, 'declared'))
        return
      }
      const all = Buffer.concat([held, bytes])
      held = all.subarray(all.byteLength - 1)
      callback(null, all.subarray(0, all.byteLength - 1))
    },
    flush(callback) {
      if (seen < declaredBytes) {
        callback(new SizeShortfallError(declaredBytes, seen))
        return
      }
      callback(null, held)
    },
  })
  // Not `pipeline`: when the caller's stream is destroyed without an error (the upload failed and the
  // library is releasing it), `pipeline` fails the guard with a premature-close error, which the SDK
  // forwards to its own wrappers of the body with nothing listening. Here the guard closes quietly
  // then, and an error of the source itself still fails the guard.
  const { errored, destroyed, readableEnded } = source as Partial<Readable>
  let ended = readableEnded === true
  source.once('end', () => {
    ended = true
  })
  source.once('error', (err: unknown) => {
    guard.destroy(err instanceof Error ? err : new Error(String(err)))
  })
  source.once('close', () => {
    if (!ended) guard.destroy()
  })
  guard.once('close', () => {
    destroyStream(source)
  })
  guard.on('error', () => undefined)
  // A source that failed before this call will not report it again, and one destroyed before its end
  // was read has nothing more to give.
  if (errored || (destroyed && !ended)) guard.destroy(errored ?? prematureClose())
  source.pipe(guard)
  return guard
}
