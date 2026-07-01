/**
 * @fileoverview Per-call options and the result shape for
 * `StorageService.deleteMany()`.
 * @layer server/interfaces
 */

/** Per-call options for a batch delete. */
export interface DeleteManyOptions {
  bucket?: string
}

/** A single failed key from a batch delete, with a readable provider error. */
export interface FailedDeletion {
  key: string
  error: string
}

/** Aggregated outcome of a batch delete: succeeded keys and per-key failures. */
export interface DeleteManyResult {
  deleted: string[]
  failed: FailedDeletion[]
}
