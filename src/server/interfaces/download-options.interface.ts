/**
 * @fileoverview Per-call options for `StorageService.download()` and `downloadBuffer()`.
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

/** Options for a single `downloadBuffer()` call. */
export interface DownloadBufferOptions extends DownloadOptions {
  /**
   * The most bytes `downloadBuffer()` will hold. An object whose `Content-Length` is larger is
   * refused before its body is read, and a body that turns out longer than this (a missing or
   * wrong `Content-Length`) is cut off as it is counted; both reject `STORAGE_SIZE_EXCEEDED` and
   * release the connection. An integer of at least `1`. Without it the whole object is buffered.
   */
  maxBytes?: number
}
