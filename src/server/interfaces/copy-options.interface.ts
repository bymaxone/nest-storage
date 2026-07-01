/**
 * @fileoverview Per-call options for `StorageService.copy()`.
 * @layer server/interfaces
 */

/** Options for a server-side object copy. */
export interface CopyOptions {
  sourceKey: string
  destinationKey: string
  sourceBucket?: string
  destinationBucket?: string
  publicRead?: boolean
  cacheControl?: string
}
