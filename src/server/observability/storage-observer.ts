/**
 * @fileoverview What runs around a public operation: it counts the outcome, times the call, and wraps it in a
 * span when one is asked for. Nothing here can change what the operation returns or throws.
 * @layer server/observability
 */
import { Inject, Injectable } from '@nestjs/common'
import { absorb } from '../utils/absorb'
import { assertCleanRoot, dispatch, rejectedWith, tagged } from '../utils/prototype-guard'
import { verdictOf } from '../utils/settle-or-cut'
import { releaseAnswer } from '../utils/release-answer'
import { StorageMetricsTally } from './storage-metrics-tally'
import { outcomeOf, scanVerdictOfError, type StorageOperation } from './storage-operations'
import { StorageTracing, type StorageSpanAttributes, type StorageSpanName } from './storage-tracing'

/** What an observed operation adds to the plain count and timing. */
export interface ObservedOptions<T> {
  /** The span to start around the operation. */
  readonly span?: StorageSpanName
  /** Attributes the span starts with. */
  readonly attributes?: StorageSpanAttributes
  /** What the span states of a successful result. */
  readonly describe?: (result: T) => StorageSpanAttributes
  /** The bytes of a successful result that reached the provider, for the upload counter. */
  readonly bytes?: (result: T) => number | undefined
  /** The stream a successful result holds, destroyed when the call is refused after producing it. */
  readonly answerStream?: (result: T) => NodeJS.ReadableStream
}

/** Seconds elapsed since `startedAt` (a `process.hrtime.bigint()` reading). */
function secondsSince(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9
}

/**
 * Observes the operations of the library.
 *
 * It is a seam between the services and two optional consumers: the tally the `observability` subpath
 * publishes from, and the span the host's OpenTelemetry SDK records. A service that is built without one
 * (a unit test, say) runs its operations bare.
 */
@Injectable()
export class StorageObserver {
  constructor(
    @Inject(StorageMetricsTally) private readonly tally: StorageMetricsTally,
    @Inject(StorageTracing) private readonly tracing: StorageTracing,
  ) {}

  /**
   * Runs `run`, counting how it ended and how long it took.
   *
   * @param operation - The operation, one of the closed set.
   * @param run - The operation; its result or its error passes through unchanged.
   * @param options - A span to start, and what to state of the result.
   */
  observe<T>(
    operation: StorageOperation,
    run: () => Promise<T>,
    options: ObservedOptions<T> = {},
  ): Promise<T> {
    const counted = async (): Promise<T> => {
      const startedAt = process.hrtime.bigint()
      let result: T
      try {
        result = await verdictOf(run())
      } catch (error) {
        absorb(() => {
          this.tally.operation(operation, outcomeOf(error), secondsSince(startedAt))
        })
        throw error
      }
      absorb(() => {
        this.tally.operation(operation, 'success', secondsSince(startedAt))
        this.tally.bytesUploaded(options.bytes?.(result))
      })
      return result
    }
    return options.span === undefined
      ? tagged(counted())
      : this.tracing.span(options.span, options.attributes ?? {}, counted, options.describe)
  }

  /**
   * Runs a scan, counting its verdict and wrapping it in the `storage.scan` span.
   *
   * @param mode - When the scan runs, `pre-upload` or `post-upload`.
   * @param run - The scan; its result or its error passes through unchanged.
   */
  scan<T extends { readonly status: string }>(
    mode: 'pre-upload' | 'post-upload',
    run: () => Promise<T>,
  ): Promise<T> {
    const counted = async (): Promise<T> => {
      try {
        const result = await verdictOf(run())
        absorb(() => {
          this.tally.scan(result.status === 'unknown' ? 'unknown' : 'clean')
        })
        return result
      } catch (error) {
        absorb(() => {
          this.tally.scan(scanVerdictOfError(error))
        })
        throw error
      }
    }
    return this.tracing.span('storage.scan', { 'bymax.storage.scan_mode': mode }, counted)
  }
}

/** The members a decorated method's class carries, when it was built with an observer. */
/**
 * Passes `outward` on, and destroys the stream of the answer the method produced when it rejects. The layers
 * above the method check the runtime again, and a refusal there drops an answer nobody else can reach.
 */
async function releasingOnRefusal<T>(
  outward: Promise<T>,
  produced: () => Promise<T> | undefined,
  streamOf: (result: T) => NodeJS.ReadableStream,
): Promise<T> {
  try {
    return await verdictOf(outward)
  } catch (error) {
    releaseAnswer(produced(), streamOf)
    throw error
  }
}

interface Observing {
  readonly observer?: StorageObserver
}

/**
 * Observes a public method of a service: `this.observer`, when the class holds one, counts and times it and
 * starts the span; without one the method runs as it was written.
 *
 * @param operation - The operation the method is.
 * @param options - A span to start, and what to state of the result.
 */
export function Observed<T = unknown>(
  operation: StorageOperation,
  options: ObservedOptions<T> = {},
): (target: object, key: string | symbol, descriptor: PropertyDescriptor) => void {
  return (_target, _key, descriptor) => {
    const original = descriptor.value as (...args: unknown[]) => Promise<T>
    descriptor.value = function (this: Observing, ...args: unknown[]): Promise<T> {
      // The runtime is checked before anything dispatches, and the method is called with the `apply`
      // captured at load: a replaced `Function.prototype.apply` would otherwise answer without the method
      // body, and its own guard, ever running.
      let produced: Promise<T> | undefined
      const run = (): Promise<T> => {
        assertCleanRoot()
        produced = dispatch(original, this, args)
        return produced
      }
      // Tagged on the way out: the method's synchronous start, a host's validator or tracer included, has
      // run by now, and the caller's await reads the promise's `constructor` next.
      try {
        assertCleanRoot()
        const outward =
          this.observer === undefined ? run() : this.observer.observe(operation, run, options)
        const { answerStream } = options
        return tagged(
          answerStream === undefined
            ? outward
            : releasingOnRefusal(outward, () => produced, answerStream),
        )
      } catch (error) {
        // Tagged like the success path: the refusal is awaited by the same caller, through the same `constructor`.
        return tagged(rejectedWith<T>(error))
      }
    }
  }
}
