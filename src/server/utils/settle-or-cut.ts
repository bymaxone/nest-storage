/**
 * @fileoverview Waits for a piece of work or for a cut, whichever comes first, without calling
 * `Promise.race`, `Promise.resolve` or any other static of `Promise` at the moment of the wait. Those
 * statics are read off the global at every call, so a host that replaced one after load could answer
 * a scan or a validation with a verdict of its own; the outcome here is read through the native
 * promise this module built from the constructor it captured at load. The root guard runs
 * synchronously right before each await of a verdict, and again right after it, so no member a
 * host replaced can run between the check and the await.
 * @layer server/utils
 */
import { assertCleanRoot, INTRINSIC_PROMISE, markHandled } from './prototype-guard'

/** The engine's `Promise` constructor, captured at load, so a replaced global is not read. */
const NativePromise: PromiseConstructor = INTRINSIC_PROMISE

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

/** What the wait settles with: no prototype, so no `then` is looked up on the answer. */
interface Box<V> {
  readonly value: V
}

function boxed<V>(value: V): Box<V> {
  const box = Object.create(null) as { value: V }
  box.value = value
  return box
}

/** Hands the work's outcome to the wait, a rejection included, and never rejects itself. */
async function relay<T>(work: PromiseLike<T>, cut: Cut<T>): Promise<void> {
  try {
    // No check here: `settleOrCut` checks synchronously right after this call returns, before anything
    // this await schedules can run, and that check is the one the wait's own await follows.
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
 * Awaits a verdict (a scan result, a validation result) with the root guard run synchronously right
 * before the await and again before the answer is handed on, on the rejection path as well.
 *
 * @param work - The promise whose outcome is a verdict.
 * @returns What `work` answered, unchanged.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when the runtime differs from the one at load.
 * @example
 *   const result = await verdictOf(scanner.scan(input))
 */
export async function verdictOf<T>(work: PromiseLike<T>): Promise<T> {
  markHandled(work)
  assertCleanRoot()
  let answer: T
  try {
    answer = await work
  } catch (error) {
    assertCleanRoot()
    throw error
  }
  assertCleanRoot()
  return answer
}

/**
 * Waits for `work`, or for the cut `arm` sets up, and answers with whichever comes first. The root
 * guard runs synchronously before the work is awaited and before the wait is awaited, and again
 * after it, on the rejection path as well, so a runtime that changed while the work ran is not
 * trusted with what the work answered. The answer travels in a box without a prototype.
 *
 * @param work - What is waited for; its rejection reaches the caller unchanged.
 * @param arm - Sets up the cut (a timer, an abort listener) and returns what releases it. It runs
 *   before the work is awaited and its release runs however the wait ends.
 * @returns What the work answered, or what the cut answered first.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when the runtime differs from the one at load.
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
  markHandled(work)
  let release = disarmed
  try {
    const wait = new NativePromise<Box<T | U>>((resolve, reject) => {
      const cut = {
        resolve: (value: T | U) => {
          resolve(boxed(value))
        },
        reject,
      }
      release = arm(cut)
      void relay(work, cut)
    })
    markHandled(wait)
    let answer: Box<T | U>
    // The statement before the await, so nothing replaceable runs between the check and the await.
    assertCleanRoot()
    try {
      answer = await wait
    } catch (error) {
      assertCleanRoot()
      throw error
    }
    assertCleanRoot()
    return answer.value
  } finally {
    release()
  }
}
