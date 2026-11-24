/**
 * @fileoverview Rows for `settleOrCut`: the work's outcome, the cut winning, the release running however
 * the wait ends, and the runtime check after the work.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { nothing, settleOrCut, type Cut } from './settle-or-cut'

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
