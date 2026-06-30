/**
 * @fileoverview Per-call options for `StorageService.download()`.
 * @layer server/interfaces
 */

/** Options for a single download call. */
export interface DownloadOptions {
  key: string
  bucket?: string
  /** S3 Range header — e.g. `'bytes=0-1023'` for partial downloads. */
  range?: string
  /** Conditional GET — only return if the ETag does NOT match. */
  ifNoneMatch?: string
  /** Conditional GET — only return if the ETag matches. */
  ifMatch?: string
}
