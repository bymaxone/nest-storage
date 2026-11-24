/**
 * @fileoverview The readiness indicator asks the bucket once, reports only `up` or `down` and no detail, keeps
 * the answer for a few seconds, shares a probe that is running, and lets a caller's abort end its own wait only.
 * @layer observability
 */
import { getEventListeners } from 'node:events'
import type { StorageService } from '@bymax-one/nest-storage'
import {
  HEALTH_INDICATOR_METADATA,
  STORAGE_HEALTH_CACHE_MS,
  STORAGE_HEALTH_INDICATOR_NAME,
  STORAGE_HEALTH_TIMEOUT_MS,
  StorageHealthIndicator,
} from './storage-health'

/** A service whose `checkBucket` is the mock given. */
function indicatorOver(checkBucket: jest.Mock): StorageHealthIndicator {
  return new StorageHealthIndicator({ checkBucket } as unknown as StorageService)
}

/**
 * An indicator from a copy of the module loaded now, so a fake clock installed first is the clock the module
 * captured: the live one is read once, at load, and never again.
 */
async function indicatorUnderFakeClock(checkBucket: jest.Mock): Promise<StorageHealthIndicator> {
  let made: StorageHealthIndicator | undefined
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('./storage-health')
    made = new fresh.StorageHealthIndicator({ checkBucket } as unknown as StorageService)
  })
  return made as unknown as StorageHealthIndicator
}

describe('StorageHealthIndicator', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('is named storage and discovered by the documented metadata key', () => {
    expect(STORAGE_HEALTH_INDICATOR_NAME).toBe('storage')
    expect(new StorageHealthIndicator(Object.create(null) as StorageService).name).toBe('storage')
    expect(HEALTH_INDICATOR_METADATA).toBe('bymax-one:health-indicator')
    expect(Reflect.getMetadata(HEALTH_INDICATOR_METADATA, StorageHealthIndicator)).toBe(true)
  })

  it('is up when the bucket answers, with no detail', async () => {
    const checkBucket = jest.fn().mockResolvedValue(undefined)

    await expect(indicatorOver(checkBucket).check()).resolves.toEqual({ status: 'up' })

    expect(checkBucket).toHaveBeenCalledTimes(1)
  })

  it('is down when the bucket refuses or cannot be reached, and says nothing of why', async () => {
    const checkBucket = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED s3.internal.example:9000 SENTINEL-4242'))

    const result = await indicatorOver(checkBucket).check()

    expect(result).toEqual({ status: 'down' })
    expect(JSON.stringify(result)).not.toContain('SENTINEL-4242')
  })

  it('asks under its own deadline of two seconds', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    const checkBucket = jest.fn().mockResolvedValue(undefined)

    await indicatorOver(checkBucket).check()

    expect(STORAGE_HEALTH_TIMEOUT_MS).toBe(2000)
    expect(timeout).toHaveBeenCalledWith(2000)
    expect(checkBucket).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal) as AbortSignal,
    })
  })

  it('is down when the probe is ended by its deadline', async () => {
    const deadline = new AbortController()
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const checkBucket = jest.fn(
      (options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.abortSignal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        }),
    )
    const pending = indicatorOver(checkBucket).check()

    deadline.abort()

    await expect(pending).resolves.toEqual({ status: 'down' })
  })

  it('keeps an answer for five seconds, up or down, and asks again after', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const checkBucket = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('x'))
    const indicator = await indicatorUnderFakeClock(checkBucket)

    await expect(indicator.check()).resolves.toEqual({ status: 'up' })
    jest.setSystemTime(1_000_000 + STORAGE_HEALTH_CACHE_MS - 1)
    await expect(indicator.check()).resolves.toEqual({ status: 'up' })
    expect(checkBucket).toHaveBeenCalledTimes(1)

    jest.setSystemTime(1_000_000 + STORAGE_HEALTH_CACHE_MS)
    await expect(indicator.check()).resolves.toEqual({ status: 'down' })
    expect(STORAGE_HEALTH_CACHE_MS).toBe(5000)
    expect(checkBucket).toHaveBeenCalledTimes(2)
    await expect(indicator.check()).resolves.toEqual({ status: 'down' })
    expect(checkBucket).toHaveBeenCalledTimes(2)
  })

  it('shares one probe among checks that arrive while it runs', async () => {
    let finish: () => void = () => undefined
    const checkBucket = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const indicator = indicatorOver(checkBucket)

    const calls = [indicator.check(), indicator.check(), indicator.check()]
    finish()

    await expect(Promise.all(calls)).resolves.toEqual([
      { status: 'up' },
      { status: 'up' },
      { status: 'up' },
    ])
    expect(checkBucket).toHaveBeenCalledTimes(1)
  })

  it('answers down at once to a signal that is already aborted, and still runs the probe for the others', async () => {
    const checkBucket = jest.fn().mockResolvedValue(undefined)
    const indicator = indicatorOver(checkBucket)

    await expect(indicator.check(AbortSignal.abort())).resolves.toEqual({ status: 'down' })
    await expect(indicator.check()).resolves.toEqual({ status: 'up' })

    expect(checkBucket).toHaveBeenCalledTimes(1)
  })

  it('ends one caller wait when its signal aborts, and does not fail the other callers', async () => {
    let finish: () => void = () => undefined
    const checkBucket = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const indicator = indicatorOver(checkBucket)
    const gone = new AbortController()
    const impatient = indicator.check(gone.signal)
    const patient = indicator.check()

    gone.abort()
    await expect(impatient).resolves.toEqual({ status: 'down' })
    finish()

    await expect(patient).resolves.toEqual({ status: 'up' })
    expect(checkBucket).toHaveBeenCalledTimes(1)
  })

  it('answers a caller whose signal never aborts with the probe, and stops listening to the signal', async () => {
    const checkBucket = jest.fn().mockResolvedValue(undefined)
    const signal = new AbortController().signal
    const removed = jest.spyOn(signal, 'removeEventListener')

    await expect(indicatorOver(checkBucket).check(signal)).resolves.toEqual({ status: 'up' })

    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('leaves no abort listener on a long-lived signal, however many checks it was given to', async () => {
    jest.useFakeTimers({ now: 1_000_000 })
    const checkBucket = jest.fn().mockResolvedValue(undefined)
    const indicator = await indicatorUnderFakeClock(checkBucket)
    const host = new AbortController()

    for (let round = 0; round < 25; round += 1) {
      jest.setSystemTime(1_000_000 + round * (STORAGE_HEALTH_CACHE_MS + 1))
      await indicator.check(host.signal)
    }
    expect(checkBucket).toHaveBeenCalledTimes(25)
    expect(getEventListeners(host.signal, 'abort')).toHaveLength(0)

    let finish: () => void = () => undefined
    checkBucket.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    jest.setSystemTime(2_000_000)
    const sharing = Array.from({ length: 25 }, () => indicator.check(host.signal))
    expect(getEventListeners(host.signal, 'abort')).toHaveLength(25)
    finish()
    await Promise.all(sharing)
    expect(getEventListeners(host.signal, 'abort')).toHaveLength(0)
  })

  it('leaves no listener on a signal that aborts while the probe runs', async () => {
    let finish: () => void = () => undefined
    const checkBucket = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const gone = new AbortController()
    const waiting = indicatorOver(checkBucket).check(gone.signal)

    gone.abort()
    await expect(waiting).resolves.toEqual({ status: 'down' })

    expect(getEventListeners(gone.signal, 'abort')).toHaveLength(0)
    finish()
  })
  it('stays down when Promise.prototype.then is replaced after load to answer a refusal as success', async () => {
    // The verdict is chained with the `then` captured at load, so a host that replaced it afterwards, to run the
    // success handler when the bucket refused, does not make the bucket `up`. The replacement acts only on the
    // bucket's own promise, so the test runner's use of `then` is left alone.
    let refused: Promise<never> | undefined
    const checkBucket = jest.fn(() => {
      refused = Promise.reject(new Error('refused'))
      return refused
    })
    const original = Promise.prototype.then
    Promise.prototype.then = function replaced(
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      const flip = this === refused && onRejected !== undefined
      return original.call(this, onFulfilled, flip ? () => onFulfilled?.(undefined) : onRejected)
    } as typeof Promise.prototype.then
    let result: unknown
    try {
      result = await indicatorOver(checkBucket).check(new AbortController().signal)
    } finally {
      Promise.prototype.then = original
    }

    expect(result).toEqual({ status: 'down' })
  })

  it('hands back a promise with its own fixed constructor, for each of the three ways a check answers', async () => {
    // A caller's `await` reads `constructor` first: an own, read-only one that is the engine's `Promise` keeps a
    // `then` or a `constructor` a host replaced on the prototype out of the way the verdict reaches the caller.
    const pending = indicatorOver(jest.fn().mockResolvedValue(undefined)).check(
      new AbortController().signal,
    )
    const cached = indicatorOver(jest.fn().mockResolvedValue(undefined))
    await cached.check(new AbortController().signal)
    const again = cached.check(new AbortController().signal)
    const aborted = indicatorOver(jest.fn().mockResolvedValue(undefined)).check(AbortSignal.abort())

    for (const answer of [pending, again, aborted]) {
      expect(Object.getOwnPropertyDescriptor(answer, 'constructor')).toMatchObject({
        value: Promise,
        writable: false,
        configurable: false,
      })
    }
    await Promise.all([pending, again, aborted])
  })

  it('stays down for an aborted caller when Promise.resolve is replaced after load to answer up', async () => {
    const checkBucket = jest.fn().mockResolvedValue(undefined)
    const original = Promise.resolve
    Promise.resolve = (() => original.call(Promise, 'up')) as typeof Promise.resolve
    let result: unknown
    try {
      result = await indicatorOver(checkBucket).check(AbortSignal.abort())
    } finally {
      Promise.resolve = original
    }

    expect(result).toEqual({ status: 'down' })
  })
})
