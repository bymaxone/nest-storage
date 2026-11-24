/**
 * @fileoverview A promise a decision path hands back carries its own constructor: after a host's code ran in the
 * synchronous start of the call and replaced the one on `Promise.prototype`, the caller's `await` does not queue a
 * job that calls the live `then` on it.
 * @layer server/utils
 */
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { Observed } from '../observability/storage-observer'
import { StorageTracing } from '../observability/storage-tracing'
import { abortable } from './abort-support'
import { settleOrCut, verdictOf } from './settle-or-cut'

/** What the host's tracer does when a span starts. */
let onSpanStart: () => void = () => undefined

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startActiveSpan: (_name: string, _options: unknown, fn: (span: unknown) => unknown) => {
        onSpanStart()
        return fn({
          setStatus: () => undefined,
          setAttributes: () => undefined,
          end: () => undefined,
        })
      },
    }),
  },
}))

/** What a host does in a hook: leaves a constructor of its own on `Promise.prototype`, then a `then` that records. */
interface Window {
  /** What the host's hook calls. */
  plant: () => void
  /** The receivers `then` was called on while the window was open. */
  receivers: unknown[]
  /** Puts both members back. */
  restore: () => void
}

function openWindow(): Window {
  class Replacement<T> extends Promise<T> {}
  const constructorKey = Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor')!
  const original = Promise.prototype.then
  const receivers: unknown[] = []
  Promise.prototype.then = function recording(this: Promise<unknown>, ...args: unknown[]) {
    receivers.push(this)
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof Promise.prototype.then
  return {
    receivers,
    plant: () => {
      Reflect.defineProperty(Promise.prototype, 'constructor', {
        value: Replacement,
        configurable: true,
        writable: true,
      })
    },
    restore: () => {
      Reflect.defineProperty(Promise.prototype, 'constructor', constructorKey)
      Promise.prototype.then = original
    },
  }
}

/** A thenable whose `then` is the host's hook: it runs in the synchronous start of the call that follows it. */
function hookThenable(plant: () => void): PromiseLike<string> {
  const thenable = {
    then(onFulfilled?: (value: string) => unknown): void {
      plant()
      onFulfilled?.('answer')
    },
  }
  return thenable as unknown as PromiseLike<string>
}

/** Awaits `returned` the way a caller does, and answers whether the live `then` was called on it. */
async function liveThenCalledOn(returned: Promise<unknown>, host: Window): Promise<boolean> {
  // What the library itself does with its own copy while it starts is its own business, so the jobs it queued
  // are let through first, and only the caller's await is measured.
  returned.catch(() => undefined)
  await new Promise<void>((resolve) => setImmediate(resolve))
  host.receivers.length = 0
  try {
    await returned
  } catch {
    // The library refuses the replaced constructor, which is its own row's business.
  }
  return host.receivers.includes(returned)
}

describe('a promise returned from a decision path', () => {
  it.each([
    ['verdictOf', (plant: () => void) => verdictOf(hookThenable(plant))],
    [
      'settleOrCut',
      (plant: () => void) =>
        settleOrCut(hookThenable(plant), () => () => {
          // Nothing to release.
        }),
    ],
    [
      'abortable',
      (plant: () => void) =>
        abortable(
          hookThenable(plant) as unknown as Promise<string>,
          {
            aborted: false,
            addEventListener: () => undefined,
          } as unknown as AbortSignal,
          {},
        ),
    ],
  ])('from %s is awaited without a call to the live then', async (_name, call) => {
    const host = openWindow()
    let live: boolean
    try {
      live = await liveThenCalledOn(call(host.plant), host)
    } finally {
      host.restore()
    }

    expect(live).toBe(false)
  })

  it('from a decorated method is awaited without a call to the live then', async () => {
    class Service {
      constructor(readonly plant: () => void) {}

      @Observed('head')
      method(): Promise<string> {
        this.plant()
        return Promise.resolve('real')
      }
    }
    const host = openWindow()
    let live: boolean
    try {
      live = await liveThenCalledOn(new Service(host.plant).method(), host)
    } finally {
      host.restore()
    }

    expect(live).toBe(false)
  })

  it('from a decorated method that refuses the dirty runtime is awaited without a call to the live then', async () => {
    class Service {
      @Observed('head')
      method(): Promise<string> {
        return Promise.resolve('real')
      }
    }
    const host = openWindow()
    let live: boolean
    let refusal: unknown
    try {
      host.plant()
      const returned = new Service().method()
      refusal = await returned.catch((error: unknown) => error)
      live = await liveThenCalledOn(new Service().method(), host)
    } finally {
      host.restore()
    }

    expect(refusal).toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED } },
    })
    expect(live).toBe(false)
  })

  it('from the span seam is awaited without a call to the live then', async () => {
    const tracing = new StorageTracing()
    await tracing.onModuleInit()
    const host = openWindow()
    onSpanStart = host.plant
    let live: boolean
    try {
      live = await liveThenCalledOn(
        tracing.span('storage.upload', {}, () => Promise.resolve('real')),
        host,
      )
    } finally {
      onSpanStart = () => undefined
      host.restore()
    }

    expect(live).toBe(false)
  })

  it('keeps the refusal the replaced constructor causes', async () => {
    const host = openWindow()
    let failure: unknown
    try {
      failure = await verdictOf(hookThenable(host.plant)).catch((error: unknown) => error)
    } finally {
      host.restore()
    }

    expect(failure).toMatchObject({
      response: { error: { code: STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED } },
    })
  })
})
