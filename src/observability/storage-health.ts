/**
 * @fileoverview Reports whether the bucket the module works through answers.
 *
 * This package imports no other Bymax library. The readiness contract of `@bymax-one/nest-core` that this class
 * meets is written out below, and the key `BymaxCoreModule` discovers an indicator by is the documented string
 * literal; a spec compares both with the published declarations.
 *
 * @layer observability
 */
import { Inject, Injectable, SetMetadata } from '@nestjs/common'
import { StorageService } from '@bymax-one/nest-storage'

/**
 * What the readiness verdict is built from, taken when this module loads: a `Promise.prototype.then` or a
 * `Promise.resolve` a host replaced afterwards cannot turn a `down` into an `up`, because neither is read at a
 * check. The module imports nothing of the server entry's internals, so it holds its own copies.
 */
const applyCaptured = Reflect.apply
const getPrototype = Object.getPrototypeOf.bind(Object) as (target: unknown) => object
const create = Object.create.bind(Object) as (prototype: null) => Record<string, unknown>
const defineOwn = Object.defineProperty.bind(Object) as (
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
) => unknown
/**
 * The constructor the promise prototype names, accepted only when it is the engine's: its `prototype` is the
 * prototype an async function's promise has; a slot replaced
 * before this module loaded would otherwise become the baseline.
 */
function checkedPromise(candidate: unknown, prototype: object): PromiseConstructor {
  if (typeof candidate !== 'function' || Reflect.get(candidate, 'prototype') !== prototype) {
    throw new Error('The Promise constructor is not the engine one: refusing to load.')
  }
  return candidate as PromiseConstructor
}
/** The engine's own promise prototype, read from an async function's promise and not from the global binding. */
const intrinsicPrototype = getPrototype(
  (async (): Promise<void> => {
    // Nothing to await: only the promise this function returns is read.
  })(),
)
const NativePromise = checkedPromise(
  Reflect.get(intrinsicPrototype, 'constructor'),
  intrinsicPrototype,
)
const nativeThen = Reflect.get(intrinsicPrototype, 'then') as () => unknown

/**
 * Gives a promise built here an own, fixed `constructor`, set from a descriptor without a prototype: whoever
 * awaits it reads that, never the one on the prototype, which a host hook may have replaced since load.
 */
function pinned<P extends Promise<unknown>>(own: P): P {
  const pin = create(null)
  pin.value = NativePromise
  pin.configurable = false
  pin.writable = false
  defineOwn(own, 'constructor', pin)
  return own
}

/** Chains on `work` with the `then` captured at load; the derived promise is pinned and handled before it is handed on. */
function chain<T, R>(
  work: Promise<T>,
  onValue: (value: T) => R,
  onError?: (error: unknown) => R,
): Promise<R> {
  const derived = pinned(applyCaptured(nativeThen, pinned(work), [onValue, onError]) as Promise<R>)
  applyCaptured(nativeThen, derived, [ignore, ignore])
  return derived
}

function ignore(): void {
  // A settlement nobody reads: the promise is only being marked as handled.
}

/** The answer with no prototype, so no `then` anywhere is looked up when it is resolved with. */
function answerOf(status: 'up' | 'down'): HealthIndicatorResult {
  const answer = create(null)
  answer.status = status
  return answer as unknown as HealthIndicatorResult
}

/** The outcome of one readiness check. */
interface HealthIndicatorResult {
  status: 'up' | 'down'
  details?: Record<string, unknown>
}

/** What a readiness indicator implements. */
interface HealthIndicator {
  readonly name: string
  check(signal?: AbortSignal): Promise<HealthIndicatorResult>
}

/** The metadata key a health module discovers indicators by. */
export const HEALTH_INDICATOR_METADATA = 'bymax-one:health-indicator'

/** The name the indicator reports under. */
export const STORAGE_HEALTH_INDICATOR_NAME = 'storage'

/** How long the probe may take before it is `down`. */
export const STORAGE_HEALTH_TIMEOUT_MS = 2000

/** How long an answer is kept before the bucket is asked again, so a readiness poll cannot become a request flood. */
export const STORAGE_HEALTH_CACHE_MS = 5000

/**
 * The readiness check of the bucket.
 *
 * It asks `StorageService.checkBucket()` for one `HeadBucket`: nothing is written and no object is read. A bucket
 * that cannot be reached, a refusal, or an answer that does not come within {@link STORAGE_HEALTH_TIMEOUT_MS} is
 * `down`. The answer, up or down, is kept for {@link STORAGE_HEALTH_CACHE_MS}, and checks that arrive while one is
 * running share it. No detail is reported, so nothing about the store (its name, its region or its endpoint)
 * leaves with it. The aggregator's signal ends the wait of that caller only: the shared probe runs under its own
 * deadline, so one caller giving up cannot fail the others.
 */
@SetMetadata(HEALTH_INDICATOR_METADATA, true)
@Injectable()
export class StorageHealthIndicator implements HealthIndicator {
  readonly name = STORAGE_HEALTH_INDICATOR_NAME
  #answer: { readonly at: number; readonly status: 'up' | 'down' } | undefined
  #running: Promise<'up' | 'down'> | undefined

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** Whether the bucket answers in time; the aggregator's signal ends this caller's wait. */
  check(signal?: AbortSignal): Promise<HealthIndicatorResult> {
    const kept = this.#answer
    if (kept !== undefined && Date.now() - kept.at < STORAGE_HEALTH_CACHE_MS) {
      return pinned(
        new NativePromise<HealthIndicatorResult>((resolve) => {
          resolve(answerOf(kept.status))
        }),
      )
    }
    // Followed with the captured `then`, never awaited: the answer is built here, after the last step that could
    // run host code, and handed on without a prototype.
    return pinned(
      new NativePromise<HealthIndicatorResult>((resolve) => {
        const settle = (status: 'up' | 'down'): void => {
          resolve(answerOf(status))
        }
        void chain(this.waitFor(this.#running ?? this.probe(), signal), settle, () => {
          settle('down')
        })
      }),
    )
  }

  /** The shared probe: one `HeadBucket` under its own deadline, remembered when it ends. */
  private probe(): Promise<'up' | 'down'> {
    const checked = chain(
      this.storage.checkBucket({ abortSignal: AbortSignal.timeout(STORAGE_HEALTH_TIMEOUT_MS) }),
      () => 'up' as const,
      () => 'down' as const,
    )
    const running = chain(checked, (status) => {
      this.#answer = { at: Date.now(), status }
      this.#running = undefined
      return status
    })
    this.#running = running
    return running
  }

  /** `probe`'s answer, or `down` as soon as `signal` aborts. */
  private waitFor(
    probe: Promise<'up' | 'down'>,
    signal: AbortSignal | undefined,
  ): Promise<'up' | 'down'> {
    if (signal === undefined) return probe
    if (signal.aborted) {
      return pinned(
        new NativePromise<'up' | 'down'>((resolve) => {
          resolve('down')
        }),
      )
    }
    return pinned(
      new NativePromise<'up' | 'down'>((resolve) => {
        const stop = (): void => {
          signal.removeEventListener('abort', stop)
          resolve('down')
        }
        signal.addEventListener('abort', stop)
        void chain(probe, (status) => {
          signal.removeEventListener('abort', stop)
          resolve(status)
        })
      }),
    )
  }
}
