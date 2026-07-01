/**
 * @fileoverview Per-call options and results for the signed-URL operations
 * (GET, PUT, and multipart).
 * @layer server/interfaces
 */

/** Options for a signed GET URL. */
export interface SignedGetUrlOptions {
  key: string
  bucket?: string
  /** Silently clamped to `signedUrls.maxTtlSeconds`. */
  ttlSeconds?: number
  /** e.g. `'attachment; filename="invoice.pdf"'` — overrides on download. */
  responseContentDisposition?: string
  responseContentType?: string
}

/** Options for a signed PUT URL. */
export interface SignedPutUrlOptions {
  key: string
  bucket?: string
  /** Content-Type the client MUST send (it becomes part of the signature). */
  contentType: string
  ttlSeconds?: number
  /**
   * Advisory maximum upload size. NOT enforced at presign time — a SigV4 PUT
   * signature can only pin an exact `Content-Length`, never a maximum, so the
   * library does not bind it. Enforce it post-upload via a HEAD/size check plus
   * the scanner path.
   */
  maxSizeBytes?: number
  publicRead?: boolean
  metadata?: Record<string, string>
}

/** Options for presigning a multipart upload. */
export interface MultipartUploadUrlsOptions {
  key: string
  bucket?: string
  contentType: string
  /** Number of parts to presign. */
  parts: number
  ttlSeconds?: number
}

/** Result of presigning a multipart upload. */
export interface MultipartUploadUrlsResult {
  uploadId: string
  partUrls: { partNumber: number; url: string }[]
  completeUrl: string
}
