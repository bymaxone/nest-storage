/**
 * @fileoverview Per-call options and the result shape for
 * `StorageService.deleteMany()`.
 * @layer server/interfaces
 */

/** Per-call options for a batch delete. */
export interface DeleteManyOptions {
  bucket?: string
}

/** A single failed key from a batch delete. */
export interface FailedDeletion {
  key: string
  /**
   * The provider's error code for this key (for example `AccessDenied`), or, when the whole request
   * failed, a fixed reason: `unreachable`, `timeout`, `provider-error`, `credentials-refused` or
   * `rejected`. Never the text of the driver or of the provider.
   */
  error: string
}

/** Aggregated outcome of a batch delete: succeeded keys and per-key failures. */
export interface DeleteManyResult {
  deleted: string[]
  failed: FailedDeletion[]
}
