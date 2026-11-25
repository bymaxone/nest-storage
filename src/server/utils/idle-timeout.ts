/**
 * @fileoverview Idle guard for a stream that feeds a multipart upload: while the
 * uploader is waiting on the source for more bytes, a silent source is cut off
 * after a fixed time instead of holding the server-side upload open forever.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import { describeError } from './describe-error'
import { assertCleanRoot, follow } from './prototype-guard'
import { destroyStream, isBufferLike, type UploadBody } from './stream-utils'

/** Thrown into the uploader when its source delivered nothing for the allowed time. */
export class SourceIdleError extends Error {
  constructor(readonly idleMs: number) {
    super(`The upload source delivered no bytes for ${String(idleMs)} ms`)
    this.name = 'SourceIdleError'
  }
}

/**
 * Whether a value is an error: an object with a `name` and a `message`, which an `Error`, a
 * `DOMException` (an abort or timeout signal's reason) and an error from another realm (a `vm` context,
 * a test sandbox) all are, though `instanceof Error` is not true for an error from another realm.
 * Re-wrapping one would drop its name and its `code`.
 */
function isError(value: unknown): value is Error {
  const candidate = value as { name?: unknown; message?: unknown } | null | undefined
  try {
    return typeof candidate?.name === 'string' && typeof candidate.message === 'string'
  } catch {
    // A value whose `name` or `message` throws when read is not an error, and the read it came from must
    // still settle: a throw here would leave the wrapped promise pending with its timer already cleared.
    return false
  }
}

/**
 * Waits for `next` and hands its outcome to a callback, or hands {@link SourceIdleError} to the error callback
 * if it does not settle in `idleMs`. The outcome is followed with the `then` captured at load and travels
 * through callbacks, never through a promise this module resolves with the step, so a `then` a host replaced
 * after load cannot rewrite the bytes of a step that was validated. Nothing here decides what the library
 * reports about a payload: the step is the source's own and is passed on unchanged.
 */
function readWithinIdleTime<T>(
  next: PromiseLike<T>,
  idleMs: number,
  onValue: (value: T) => void,
  onError: (error: unknown) => void,
): void {
  let over = false
  const timer = setTimeout(() => {
    over = true
    onError(new SourceIdleError(idleMs))
  }, idleMs)
  follow(
    next,
    (value) => {
      if (over) return
      over = true
      clearTimeout(timer)
      onValue(value)
    },
    (error: unknown) => {
      if (over) return
      over = true
      clearTimeout(timer)
      onError(isError(error) ? error : new Error(describeError(error)))
    },
  )
}

/**
 * Wraps a stream so a source that stays silent for `idleMs` fails the read with a
 * {@link SourceIdleError}. The clock runs only while a chunk is being waited for, so a
 * slow consumer that is not asking for data never trips it, and every chunk restarts it.
 * Destroying the wrapper, for any reason, destroys the source without an error.
 *
 * The wrapper carries a no-op `'error'` listener for its whole life: it is consumed by the
 * uploader, which reports the failure itself, and an unheard `'error'` would crash the process.
 *
 * @param source - The caller's stream.
 * @param idleMs - Longest silence allowed, in milliseconds; must be greater than 0.
 * @param toError - Optional mapping applied to the failure the wrapper is destroyed with.
 * @returns A readable that yields the source's chunks unchanged.
 */
export function withIdleTimeout(
  source: NodeJS.ReadableStream,
  idleMs: number,
  toError?: (error: Error) => Error,
): Readable {
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>
  // The runtime is scanned before the first bytes are handed on and again when the source ends, not for every
  // chunk: a scan walks every guarded built-in, and a stream of many chunks would pay it as often.
  let scanned = false
  const wrapper = new Readable({
    objectMode: false,
    // No read-ahead: with a buffer to fill, Node calls read() while the consumer is paused, and the
    // clock would run for bytes nobody has asked for. At 0, read() runs only on demand.
    highWaterMark: 0,
    read() {
      // A Readable calls read() again only after the pending one has pushed, so reads never overlap.
      const fail = (error: unknown): void => {
        wrapper.destroy(toError ? toError(error as Error) : (error as Error))
      }
      readWithinIdleTime(
        iterator.next(),
        idleMs,
        (step) => {
          try {
            // A replaced built-in is refused before the first bytes are handed on, and one planted later and left
            // in place is refused when the source ends, before the stream is closed as complete.
            if (!scanned || step.done === true) {
              assertCleanRoot()
              scanned = true
            }
            wrapper.push(step.done === true ? null : step.value)
          } catch (error) {
            fail(error)
          }
        },
        fail,
      )
    },
    destroy(error, callback) {
      // Why this is a plain Readable and not Readable.from(asyncGenerator): a generator's return()
      // queues behind the read it is parked on, and a silent source never completes that read, so
      // neither the idle error nor a consumer's early destroy could release the source.
      destroyStream(source)
      callback(error)
    },
  })
  wrapper.once('error', () => undefined)
  return wrapper
}

/**
 * Applies {@link withIdleTimeout} to a stream body. A buffer cannot stall, so it is returned
 * as is, and an `idleMs` of `0` turns the guard off.
 *
 * @param body - The upload body.
 * @param idleMs - Longest silence allowed; `0` disables the guard.
 * @returns The body to hand to the uploader.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when the body cannot be examined; the error is the `cause`.
 */
export function guardIdleBody(body: UploadBody, idleMs: number): Buffer | Uint8Array | Readable {
  // Examining a body runs host code when it is a Proxy (its `getPrototypeOf` trap), so a throw anywhere here is
  // the library's refusal with the host's error as the cause.
  try {
    if (isBufferLike(body)) {
      return body
    }
    if (idleMs !== 0) return withIdleTimeout(body, idleMs)
    // A stream that is not a `Readable` (an old-style stream that only has `pipe`) is adapted, since the
    // uploader needs a `Readable`; a `Readable` goes through as it is.
    return body instanceof Readable ? body : new Readable().wrap(body)
  } catch (error) {
    throw new StorageException(
      STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED,
      undefined,
      { reason: 'the stream body could not be read' },
      undefined,
      error,
    )
  }
}
