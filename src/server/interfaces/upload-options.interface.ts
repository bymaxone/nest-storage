/**
 * @fileoverview Per-call options for `StorageService.upload()`.
 * @layer server/interfaces
 */

/** Options for a single upload call. */
export interface UploadOptions {
  key: string
  /** Buffer (small/medium), Readable (large), or Uint8Array. */
  body: Buffer | NodeJS.ReadableStream | Uint8Array
  contentType: string
  bucket?: string
  /** Required for validation and optimal multipart sizing. */
  size?: number
  cacheControl?: string
  /** `'inline'`, `'attachment'`, or a full `Content-Disposition` value. */
  contentDisposition?: string
  /** Default: `defaultPublicRead` from module options. */
  publicRead?: boolean
  /** `'NONE'` forces no SSE even when a default is set globally. */
  serverSideEncryption?: 'AES256' | 'aws:kms' | 'NONE'
  kmsKeyId?: string
  /** Custom `x-amz-meta-*` headers. */
  metadata?: Record<string, string>
  /**
   * If the same `idempotencyKey` was seen within the cache TTL window, the
   * cached `UploadResult` is returned without re-uploading.
   */
  idempotencyKey?: string
  /** Progress callback fired after each multipart part (or once for single). */
  onProgress?: (event: { loaded: number; total?: number; part?: number }) => void
}
