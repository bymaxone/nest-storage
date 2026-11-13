/**
 * @fileoverview The size guard for a stream body: counts the bytes that pass and fails the read
 * the moment the count exceeds a limit, destroying the source so nothing more is pulled from it.
 * @layer server/utils
 */
import { Transform, pipeline, type Readable } from 'node:stream'

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
  pipeline(source as Readable, guard, () => undefined)
  return guard
}
