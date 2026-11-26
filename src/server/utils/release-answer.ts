/**
 * @fileoverview Releases what the answer of a refused call holds: a stream with `destroy()` is destroyed
 * and a web `ReadableStream` is cancelled. A value with neither is left as it is.
 * @layer server/utils
 */
import { absorb } from './absorb'
import { follow } from './prototype-guard'
import { destroyStream } from './stream-utils'

function release(held: unknown): unknown {
  const web = held as { destroy?: unknown; cancel?: () => unknown } | null | undefined
  // A web stream has no destroy(). Cancelling a locked one rejects; its lock holder releases it then.
  if (typeof web?.destroy !== 'function' && typeof web?.cancel === 'function') {
    return web.cancel()
  }
  destroyStream(held as NodeJS.ReadableStream)
  return undefined
}

function ignore(): void {
  // A work that rejected holds no stream.
}

/**
 * Releases the stream of an answer, now or when it arrives.
 *
 * @param work - The promise whose caller was refused.
 * @param streamOf - The stream the answer holds, if any.
 */
export function releaseAnswer<T>(
  work: PromiseLike<T> | undefined,
  streamOf: (answer: T) => unknown,
): void {
  // A client that threw before answering left nothing to wait for.
  if (work === undefined) {
    return
  }
  follow(
    work,
    // The caller already has its error: a throw here would be an unhandled rejection.
    (answer) => {
      absorb(() => release(streamOf(answer)))
    },
    ignore,
  )
}

/**
 * The stream a `download` answer holds.
 *
 * @param answer - What `download` resolved with.
 * @returns Its stream.
 */
export function downloadedStream(answer: { stream: NodeJS.ReadableStream }): NodeJS.ReadableStream {
  return answer.stream
}
