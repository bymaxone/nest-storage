/**
 * @fileoverview Publishes what the storage operations counted to the application's metrics registry.
 *
 * An optional subpath: it names `prom-client`, which an application that publishes no metrics never installs, so
 * nothing outside `src/observability` may import it. The counts are kept by `StorageMetricsTally` in the server
 * entry, in plain numbers; this class only reads them.
 *
 * This package imports no other Bymax library. The contract of `@bymax-one/nest-core` that this class meets is
 * written out below, and the key `BymaxCoreModule` discovers a contributor by is the documented string literal,
 * so nothing here names that package; a spec compares both with the published declarations.
 *
 * @layer observability
 */
import { Inject, Injectable, SetMetadata } from '@nestjs/common'
import { Counter, Histogram } from 'prom-client'
import type { Registry } from 'prom-client'
import {
  SCAN_VERDICTS,
  STORAGE_OPERATIONS,
  STORAGE_OUTCOMES,
  StorageMetricsTally,
} from '@bymax-one/nest-storage'

/** The registry the application's scrape endpoint serves. */
type MetricsRegistry = Registry

/** What a component that publishes metrics implements: it receives the registry at bootstrap. */
interface MetricsContributor {
  registerMetrics(registry: MetricsRegistry): void
}

/** The metadata key a metrics module discovers contributors by. */
export const METRICS_CONTRIBUTOR_METADATA = 'bymax-one:metrics-contributor'

/**
 * Registers the storage collectors on the registry the scrape endpoint serves.
 *
 * The counters are read from the tally on each scrape, after a reset, instead of being written as events
 * arrive: the tally starts counting before this class runs, and a counter fed by events would drop that window.
 * The duration histogram cannot be rebuilt from counts, so it is fed as operations end, from the moment this
 * class registers it. Labels are the closed sets the tally is keyed by; no key, bucket, prefix, tenant or message
 * ever becomes one.
 *
 * @example
 * // providers: [StorageMetrics]  (BymaxCoreModule discovers it and calls registerMetrics once at bootstrap)
 */
@SetMetadata(METRICS_CONTRIBUTOR_METADATA, true)
@Injectable()
export class StorageMetrics implements MetricsContributor {
  constructor(@Inject(StorageMetricsTally) private readonly tally: StorageMetricsTally) {}

  /** Registers the collectors; called once at bootstrap by the metrics module. */
  registerMetrics(registry: MetricsRegistry): void {
    const { tally } = this
    new Counter({
      name: 'bymax_storage_operations_total',
      help: 'Storage operations by operation and outcome (success, not_found, aborted, error).',
      labelNames: ['operation', 'outcome'],
      registers: [registry],
      collect(): void {
        this.reset()
        const { operations } = tally.snapshot()
        for (const operation of STORAGE_OPERATIONS) {
          for (const outcome of STORAGE_OUTCOMES) {
            this.inc({ operation, outcome }, operations[operation][outcome])
          }
        }
      },
    })
    const duration = new Histogram({
      name: 'bymax_storage_operation_duration_seconds',
      help: 'Time a storage operation took, by operation: to the response for a download, to the end otherwise.',
      labelNames: ['operation'],
      registers: [registry],
    })
    for (const operation of STORAGE_OPERATIONS) duration.zero({ operation })
    tally.onDuration((operation, seconds) => {
      duration.observe({ operation }, seconds)
    })
    new Counter({
      name: 'bymax_storage_bytes_uploaded_total',
      help: 'Bytes of objects uploaded, counted when the upload succeeded and not for a result the idempotency cache returned.',
      registers: [registry],
      collect(): void {
        this.reset()
        this.inc(tally.snapshot().bytesUploaded)
      },
    })
    new Counter({
      name: 'bymax_storage_scans_total',
      help: 'File scans by verdict (clean, infected, unknown, timeout, error).',
      labelNames: ['verdict'],
      registers: [registry],
      collect(): void {
        this.reset()
        const { scans } = tally.snapshot()
        for (const verdict of SCAN_VERDICTS) this.inc({ verdict }, scans[verdict])
      },
    })
  }
}
