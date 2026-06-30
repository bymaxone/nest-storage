/**
 * @fileoverview Pure data shapes returned by storage operations. Zero NestJS or
 * AWS SDK dependencies — safe to import in frontends, edge functions, or other
 * non-Node environments.
 * @layer shared/types
 */

/** Outcome of an upload — returned to the caller. */
export interface UploadResult {
  /** Final key after normalization and the global key prefix. */
  key: string
  bucket: string
  etag: string
  /** Only set on versioned buckets. */
  versionId?: string
  size?: number
  contentType: string
  publicUrl: string
  /** True when the multipart pathway was used. */
  multipart: boolean
  /** True when the result was returned from the idempotency cache. */
  fromIdempotencyCache: boolean
}

/** Object metadata as returned by `head()` and `download()`. */
export interface ObjectMetadata {
  key: string
  bucket: string
  size: number
  contentType: string
  etag: string
  lastModified: Date
  cacheControl?: string
  contentDisposition?: string
  /** `x-amz-meta-*` custom metadata. */
  metadata: Record<string, string>
  /** S3 storage class (STANDARD, GLACIER, etc.). */
  storageClass?: string
  versionId?: string
}

/** Result row returned by `list()`. */
export interface ListedObject {
  key: string
  size: number
  etag: string
  lastModified: Date
  storageClass?: string
}
