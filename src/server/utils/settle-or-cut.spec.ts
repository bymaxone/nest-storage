/**
 * @fileoverview Rows for `settleOrCut`: the work's outcome, the cut winning, the release running however
 * the wait ends, and the runtime check after the work.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { abortable } from './abort-support'
import { nothing, settleOrCut, verdictOf, type Cut } from './settle-or-cut'

/** A promise that settles when the test says so, built without a static of `Promise`. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('settleOrCut', () => {
  it('answers with what the work fulfilled with', async () => {
    /* The wait ends with the work's value and the release has run once. */
    const release = jest.fn()
    await expect(
      settleOrCut(
        nothing().then(() => 'done'),
        () => release,
      ),
    ).resolves.toBe('done')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('rejects with the work’s own reason, unchanged', async () => {
    /* A rejection of the work is the caller's rejection, the very same object. */
    const failure = new Error('work failed')
    const release = jest.fn()
    const work = deferred<string>()
    const wait = settleOrCut(work.promise, () => release)
    work.reject(failure)
    await expect(wait).rejects.toBe(failure)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('answers with the cut when it comes first, and drops what the work answers later', async () => {
    /* The cut resolves first; the work's late rejection is absorbed, not unhandled. */
    const work = deferred<string>()
    let cut: Cut<string | undefined> | undefined
    const wait = settleOrCut<string, undefined>(work.promise, (c) => {
      cut = c
      return () => undefined
    })
    cut?.resolve(undefined)
    await expect(wait).resolves.toBeUndefined()
    work.reject(new Error('late'))
    await nothing()
  })

  it('rejects with the cut’s reason when the cut fails first', async () => {
    /* The deadline-style cut rejects and the work is left to finish alone. */
    const work = deferred<string>()
    const reason = new Error('cut')
    const wait = settleOrCut(work.promise, (c) => {
      c.reject(reason)
      return () => undefined
    })
    await expect(wait).rejects.toBe(reason)
    work.resolve('late')
  })

  it('rejects with what arm threw, and still settles', async () => {
    /* An arm that throws leaves the wait rejected with that error; the no-op release runs without effect. */
    const failure = new Error('arm failed')
    await expect(
      settleOrCut(nothing(), () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  it('hands the answer on in a box, so a then planted before the answer is handed on is never called', async () => {
    /* The planted `then` erases itself and answers clean; only a box without a prototype is never asked for it. */
    const root = Object.prototype as unknown as Record<string, unknown>
    const work = deferred<{ status: string }>()
    const wait = settleOrCut(work.promise, () => () => undefined)
    queueMicrotask(() => {
      root.then = (resolve: (value: unknown) => void) => {
        Reflect.deleteProperty(root, 'then')
        resolve({ status: 'clean' })
      }
    })
    work.resolve({ status: 'infected' })
    // No prototype on what the harness hands around: it would read the planted `then` too.
    const settled = (kind: string, content: unknown): object =>
      Object.assign(Object.create(null) as object, { kind, content })
    let outcome: unknown
    try {
      outcome = await wait.then(
        (value) => settled('answer', value),
        (error: unknown) => settled('refusal', error),
      )
    } finally {
      Reflect.deleteProperty(root, 'then')
    }
    expect(outcome).toMatchObject({
      kind: 'refusal',
      content: { code: 'STORAGE_VALIDATION_FAILED' },
    })
  })

  it('refuses an outcome when the runtime changed while the work ran', async () => {
    /* A key planted on the root prototype after the work started refuses the answer. */
    const root = Object.prototype as unknown as Record<string, unknown>
    const work = deferred<string>()
    const wait = settleOrCut(work.promise, () => () => undefined)
    root.planted = 1
    work.resolve('clean')
    try {
      const error: unknown = await wait.then(
        () => undefined,
        (reason: unknown) => reason,
      )
      expect(error).toBeInstanceOf(StorageException)
    } finally {
      Reflect.deleteProperty(root, 'planted')
    }
  })
})

const proto = Promise.prototype as unknown as Record<string, unknown>
const nativeThen = Promise.prototype.then
const ownDescriptor = (name: string): PropertyDescriptor =>
  Object.getOwnPropertyDescriptor(proto, name)!
class Impostor {}

/** The two entry points that carry a verdict, called the same way. */
const entryPoints: [string, (work: Promise<string>) => Promise<unknown>][] = [
  ['verdictOf', (work) => verdictOf(work)],
  ['settleOrCut', (work) => settleOrCut(work, () => () => undefined)],
  ['abortable without a signal', (work) => abortable(work, undefined, {})],
  ['abortable with a signal', (work) => abortable(work, new AbortController().signal, {})],
]

describe.each(entryPoints)('%s and a runtime that changes around the await', (_name, enter) => {
  const refusal = { code: 'STORAGE_VALIDATION_FAILED' }

  /** Replaces the constructor of promises, and returns what puts it back. */
  function replaceConstructor(): () => void {
    const original = ownDescriptor('constructor')
    Object.defineProperty(proto, 'constructor', { ...original, value: Impostor })
    return () => {
      Object.defineProperty(proto, 'constructor', original)
    }
  }

  it('refuses before awaiting, so a then that restores the runtime and forges the answer is never reached', async () => {
    /* The constructor is replaced before the call; its `then` swaps it back and answers `forged`. */
    const work = nothing().then(() => 'clean')
    const original = ownDescriptor('constructor')
    const thenOriginal = ownDescriptor('then')
    const forger = function (
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): unknown {
      Object.defineProperty(proto, 'constructor', original)
      return nativeThen.call(this, () => onFulfilled?.('forged'), onRejected)
    }
    let outcome: unknown
    Object.defineProperty(proto, 'then', { ...thenOriginal, value: forger })
    Object.defineProperty(proto, 'constructor', { ...original, value: Impostor })
    try {
      outcome = await enter(work).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
    } finally {
      Object.defineProperty(proto, 'constructor', original)
      Object.defineProperty(proto, 'then', thenOriginal)
    }
    expect(outcome).toMatchObject({ error: refusal })
  })

  it('refuses an answer when the runtime changed while the work ran', async () => {
    /* The replacement lands after the call started and the work then fulfils. */
    let restore = (): void => undefined
    const work = nothing().then(() => {
      restore = replaceConstructor()
      return 'clean'
    })
    try {
      await expect(enter(work)).rejects.toMatchObject(refusal)
    } finally {
      restore()
    }
  })

  it('refuses a failure when the runtime changed while the work ran', async () => {
    /* The same replacement, then the work rejects: the rejection is not trusted either. */
    let restore = (): void => undefined
    const work = nothing().then(() => {
      restore = replaceConstructor()
      throw new Error('work failed')
    })
    try {
      await expect(enter(work)).rejects.toMatchObject(refusal)
    } finally {
      restore()
    }
  })
})
