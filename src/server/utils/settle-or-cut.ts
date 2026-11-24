/**
 * @fileoverview Waits for a piece of work or for a cut, whichever comes first, without calling
 * `Promise.race`, `Promise.resolve` or any other static of `Promise` at the moment of the wait. Those
 * statics are read off the global at every call, so a host that replaced one after load could answer
 * a scan or a validation with a verdict of its own; the outcome here is read through the native
 * promise this module built from the constructor it captured at load.
 * @layer server/utils
 */
import { assertCleanRoot } from './prototype-guard'

/** The `Promise` constructor as it was at load, so a later replacement of the global is not read. */
const NativePromise: PromiseConstructor = Promise

/** What a cut can do to the wait: answer it with a value, or fail it. */
export interface Cut<V> {
  /** Ends the wait with `value`, unless the work settled first. */
  readonly resolve: (value: V) => void
  /** Ends the wait with a rejection, unless the work settled first. */
  readonly reject: (reason: unknown) => void
}

/**
 * An already fulfilled promise of `undefined`, built from the captured constructor rather than from
 * `Promise.resolve`, which is read off the global at each call.
 *
 * @returns A promise that is already fulfilled with `undefined`.
 */
export function nothing(): Promise<undefined> {
  return new NativePromise<undefined>((resolve) => {
    resolve(undefined)
  })
}

/** Hands the work's outcome to the wait, a rejection included, and never rejects itself. */
async function relay<T>(work: PromiseLike<T>, cut: Cut<T>): Promise<void> {
  try {
    cut.resolve(await work)
  } catch (error) {
    cut.reject(error)
  }
}

/** Nothing was armed. */
function disarmed(): void {
  // A cut that is already gone has nothing to release.
}

/**
 * Waits for `work`, or for the cut `arm` sets up, and answers with whichever comes first. The refusal
 * of {@link assertCleanRoot} runs again before the outcome is handed back, so a runtime that changed
 * while the work ran is not trusted with what the work answered.
 *
 * @param work - What is waited for; its rejection reaches the caller unchanged.
 * @param arm - Sets up the cut (a timer, an abort listener) and returns what releases it. It runs
 *   before the work is awaited and its release runs however the wait ends.
 * @returns What the work answered, or what the cut answered first.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when the runtime changed while the work ran.
 * @example
 *   const verdict = await settleOrCut(scan(), (cut) => {
 *     const timer = setTimeout(() => cut.reject(new Error('late')), 1000)
 *     return () => clearTimeout(timer)
 *   })
 */
export async function settleOrCut<T, U = never>(
  work: PromiseLike<T>,
  arm: (cut: Cut<T | U>) => () => void,
): Promise<T | U> {
  let release = disarmed
  try {
    const outcome = await new NativePromise<T | U>((resolve, reject) => {
      release = arm({ resolve, reject })
      void relay(work, { resolve, reject })
    })
    assertCleanRoot()
    return outcome
  } finally {
    release()
  }
}
