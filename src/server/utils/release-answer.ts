/**
 * @fileoverview Releases the stream held by an answer whose caller was refused, so a download that
 * ends in a rejection does not leave its connection open.
 * @layer server/utils
 */
import { follow } from './prototype-guard'
import { destroyStream } from './stream-utils'

function ignore(): void {
  // A work that rejected holds no stream, and its reason has already reached the caller.
}

/**
 * Destroys the stream of an answer, now or when it arrives.
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
    (answer) => {
      destroyStream(streamOf(answer) as NodeJS.ReadableStream)
    },
    ignore,
  )
}
