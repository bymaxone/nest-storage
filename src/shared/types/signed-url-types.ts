/**
 * @fileoverview Result shape of a signed-URL request. Zero NestJS or AWS SDK
 * dependencies.
 * @layer shared/types
 */

/** Result of a signed URL request — the caller forwards `url` to a client. */
export interface SignedUrlResult {
  /** The presigned URL. NEVER LOG this — it is a temporary credential. */
  url: string
  /** Absolute deadline after which the provider stops accepting the URL. */
  expiresAt: Date
  /** HTTP method the client must use. */
  method: 'GET' | 'PUT'
  /**
   * Headers the client MUST include verbatim — they are part of the signature.
   * Example: `{ 'Content-Type': 'image/png' }`.
   */
  requiredHeaders: Record<string, string>
}
