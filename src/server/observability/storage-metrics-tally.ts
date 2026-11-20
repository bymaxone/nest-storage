/**
 * @fileoverview The counts the storage operations keep for whoever publishes metrics, with every label set
 * closed. It holds plain numbers, so the code that does the work never imports a metrics library.
 * @layer server/observability
 */
import { Injectable } from '@nestjs/common'
import { absorb } from '../utils/absorb'
import {
  SCAN_VERDICTS,
  STORAGE_OPERATIONS,
  STORAGE_OUTCOMES,
  type ScanVerdict,
  type StorageOperation,
  type StorageOutcome,
} from './storage-operations'

/** A zeroed count for each member of a closed set. */
function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

/** Told how long an operation took, once it ended. Typed to return a value: a listener typed `void` can still return a promise. */
export type DurationListener = (operation: StorageOperation, seconds: number) => unknown

/**
 * Counts what the storage operations do. Each count is keyed by a closed set (see `storage-operations`), so no
 * label can grow with the traffic, and nothing a caller or a host supplied is ever a key. The optional
 * `observability` subpath reads these numbers when it is scraped, and feeds a duration histogram through
 * {@link StorageMetricsTally.onDuration}.
 */
@Injectable()
export class StorageMetricsTally {
  readonly #operations = Object.fromEntries(
    STORAGE_OPERATIONS.map((operation) => [operation, zeroed(STORAGE_OUTCOMES)]),
  ) as Record<StorageOperation, Record<StorageOutcome, number>>
  readonly #scans = zeroed(SCAN_VERDICTS)
  readonly #listeners: DurationListener[] = []
  #bytesUploaded = 0

  /** An operation ended as `outcome` after `seconds`. */
  operation(operation: StorageOperation, outcome: StorageOutcome, seconds: number): void {
    this.#operations[operation][outcome] += 1
    for (const listener of this.#listeners) absorb(() => listener(operation, seconds))
  }

  /** `bytes` of an object reached the provider; anything that is not a positive finite number is ignored. */
  bytesUploaded(bytes: number | undefined): void {
    if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0)
      this.#bytesUploaded += bytes
  }

  /** A scan ended as `verdict`. */
  scan(verdict: ScanVerdict): void {
    this.#scans[verdict] += 1
  }

  /** Calls `listener` with the duration of every operation that ends from now on. */
  onDuration(listener: DurationListener): void {
    this.#listeners.push(listener)
  }

  /** The counts so far, as copies. */
  snapshot(): {
    readonly operations: Readonly<
      Record<StorageOperation, Readonly<Record<StorageOutcome, number>>>
    >
    readonly bytesUploaded: number
    readonly scans: Readonly<Record<ScanVerdict, number>>
  } {
    return {
      operations: Object.fromEntries(
        STORAGE_OPERATIONS.map((operation) => [operation, { ...this.#operations[operation] }]),
      ) as Record<StorageOperation, Record<StorageOutcome, number>>,
      bytesUploaded: this.#bytesUploaded,
      scans: { ...this.#scans },
    }
  }
}
