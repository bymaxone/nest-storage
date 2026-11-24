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
import {
  assertCleanRoot,
  boxed,
  follow,
  INTRINSIC_PROMISE,
  markHandled,
  markOwnHandled,
  tagged,
} from './prototype-guard'

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

/**
 * The outcome of `work` as a native promise of a box, followed without a live `then` and without resolving
 * with the answer itself, so a `then` on its prototype chain is never looked up either.
 */
function settled<T>(work: T | PromiseLike<T>): Promise<Box<T>> {
  return new NativePromise<Box<T>>((resolve, reject) => {
    follow(
      work,
      (value) => {
        resolve(boxed(value))
      },
      reject,
    )
  })
}

/**
 * A copy of how `work` ends, for a party that is not the caller: a native promise of `undefined` that follows
 * `work` with the captured `then`, with its own handled marker, so nothing the party does to the copy reaches
 * the promise the caller awaits.
 *
 * @param work - The promise to mirror; nothing is mirrored when it is missing.
 * @returns A pinned, handled native promise.
 */
export function mirrorOf(work: PromiseLike<unknown> | undefined): Promise<undefined> {
  const mirror = new NativePromise<undefined>((resolve, reject) => {
    if (work === undefined) {
      resolve(undefined)
      return
    }
    follow(
      work,
      () => {
        resolve(undefined)
      },
      reject,
    )
  })
  markOwnHandled(mirror)
  return mirror
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
export function verdictOf<T>(work: T | PromiseLike<T>): Promise<T> {
  // Tagged once the synchronous start, which can run a host's `then`, is over: the caller's await reads it next.
  return tagged(waitForVerdict(work, settled<T>))
}

/**
 * Waits for every item, as `Promise.all` would, without reading the static or a live `then`: each item is
 * followed with the captured `then`, and the list travels in a box without a prototype. The first rejection
 * ends the wait. The runtime is checked right before the await and again after it, as in {@link verdictOf}.
 *
 * @param items - The promises or values to wait for.
 * @returns Their answers, in order.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when the runtime differs from the one at load.
 * @example
 *   const urls = await allOf(parts.map((part) => sign(part)))
 */
export function allOf<T>(items: readonly (T | PromiseLike<T>)[]): Promise<T[]> {
  // Every item is marked before the first check, so a refusal of the runtime leaves none of them unhandled.
  let at = 0
  while (at < items.length) {
    markHandled(items[at] as PromiseLike<unknown>)
    at += 1
  }
  return tagged(waitForVerdict(items, joined<T>))
}

/** Every item followed, answered as one box. */
function joined<T>(items: readonly (T | PromiseLike<T>)[]): Promise<Box<T[]>> {
  return new NativePromise<Box<T[]>>((resolve, reject) => {
    const answers: T[] = []
    let left = items.length
    if (left === 0) {
      resolve(boxed(answers))
      return
    }
    let at = 0
    while (at < items.length) {
      const index = at
      const item = items[index] as T | PromiseLike<T>
      at += 1
      follow(
        item,
        (value) => {
          answers[index] = value
          left -= 1
          if (left === 0) resolve(boxed(answers))
        },
        reject,
      )
      markHandled(item as PromiseLike<unknown>)
    }
  })
}

async function waitForVerdict<T, W>(work: W, make: (work: W) => Promise<Box<T>>): Promise<T> {
  markHandled(work as PromiseLike<unknown>)
  assertCleanRoot()
  const wait = make(work)
  markOwnHandled(wait)
  let answer: Box<T>
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
export function settleOrCut<T, U = never>(
  work: PromiseLike<T>,
  arm: (cut: Cut<T | U>) => () => void,
): Promise<T | U> {
  return tagged(waitOrCut(work, arm))
}

async function waitOrCut<T, U>(
  work: PromiseLike<T>,
  arm: (cut: Cut<T | U>) => () => void,
): Promise<T | U> {
  markHandled(work)
  let release = disarmed
  const letGo = (): void => {
    const done = release
    release = disarmed
    done()
  }
  let answer: Box<T | U>
  try {
    const wait = new NativePromise<Box<T | U>>((resolve, reject) => {
      const cut = {
        resolve: (value: T | U) => {
          resolve(boxed(value))
        },
        reject,
      }
      release = arm(cut)
      follow(
        work,
        (value) => {
          cut.resolve(value)
        },
        (error) => {
          cut.reject(error)
        },
      )
    })
    markOwnHandled(wait)
    // The statement before the await, so nothing replaceable runs between the check and the await.
    assertCleanRoot()
    answer = await wait
  } catch (error) {
    letGo()
    assertCleanRoot()
    throw error
  }
  // The release runs replaceable built-ins, so the check is the last statement before the return, where
  // the engine reads `then` of the value it resolves with.
  letGo()
  assertCleanRoot()
  return answer.value
}
