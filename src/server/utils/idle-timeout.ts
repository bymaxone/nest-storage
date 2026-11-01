/**
 * @fileoverview Idle guard for a stream that feeds a multipart upload: while the
 * uploader is waiting on the source for more bytes, a silent source is cut off
 * after a fixed time instead of holding the server-side upload open forever.
 * @layer server/utils
 */
import { Readable } from 'node:stream'
import { describeError } from './describe-error'
import { destroyStream, isBufferLike, type UploadBody } from './stream-utils'

/** Thrown into the uploader when its source delivered nothing for the allowed time. */
export class SourceIdleError extends Error {
  constructor(readonly idleMs: number) {
    super(`The upload source delivered no bytes for ${String(idleMs)} ms`)
    this.name = 'SourceIdleError'
  }
}

/** Waits for `next`, rejecting with {@link SourceIdleError} if it does not settle in `idleMs`. */
function withinIdleTime<T>(next: Promise<T>, idleMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SourceIdleError(idleMs))
    }, idleMs)
    next.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(describeError(error)))
      },
    )
  })
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
 * @returns A readable that yields the source's chunks unchanged.
 */
export function withIdleTimeout(source: NodeJS.ReadableStream, idleMs: number): Readable {
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>
  const wrapper = new Readable({
    objectMode: false,
    read() {
      // A Readable calls read() again only after the pending one has pushed, so reads never overlap.
      withinIdleTime(iterator.next(), idleMs).then(
        (step) => {
          wrapper.push(step.done === true ? null : step.value)
        },
        (error: unknown) => {
          wrapper.destroy(error as Error)
        },
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
 */
export function guardIdleBody(body: UploadBody, idleMs: number): Buffer | Uint8Array | Readable {
  if (isBufferLike(body)) {
    return body
  }
  return idleMs === 0 ? (body as Readable) : withIdleTimeout(body, idleMs)
}
