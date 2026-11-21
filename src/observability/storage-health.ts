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
  async check(signal?: AbortSignal): Promise<HealthIndicatorResult> {
    const kept = this.#answer
    if (kept !== undefined && Date.now() - kept.at < STORAGE_HEALTH_CACHE_MS) {
      return { status: kept.status }
    }
    const status = await this.waitFor(this.#running ?? this.probe(), signal)
    return { status }
  }

  /** The shared probe: one `HeadBucket` under its own deadline, remembered when it ends. */
  private probe(): Promise<'up' | 'down'> {
    const running = this.storage
      .checkBucket({ abortSignal: AbortSignal.timeout(STORAGE_HEALTH_TIMEOUT_MS) })
      .then(
        () => 'up' as const,
        () => 'down' as const,
      )
      .then((status) => {
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
    if (signal.aborted) return Promise.resolve('down')
    return new Promise((resolve) => {
      const stop = (): void => {
        signal.removeEventListener('abort', stop)
        resolve('down')
      }
      signal.addEventListener('abort', stop)
      void probe.then((status) => {
        signal.removeEventListener('abort', stop)
        resolve(status)
      })
    })
  }
}
