/**
 * @fileoverview Pure builders that resolve S3 request headers with a per-call →
 * module-default fallback: Content-Disposition, Cache-Control, server-side
 * encryption (with a `'NONE'` sentinel that omits the header), and the ACL flag.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'

/** The subset of server-side-encryption headers sent to the S3 SDK. */
interface SseHeaders {
  ServerSideEncryption?: 'AES256' | 'aws:kms'
  SSEKMSKeyId?: string
}

/**
 * Resolves the Content-Disposition header. A per-call value wins; otherwise the
 * module default (`'inline'` or `'attachment'`) is used. A per-call value may be
 * a full RFC 6266 string (e.g. `'attachment; filename="x.pdf"'`).
 *
 * @param perCall - The per-call Content-Disposition, if any.
 * @param defaultValue - The module default.
 * @returns The resolved Content-Disposition string.
 */
export function buildContentDisposition(
  perCall: UploadOptions['contentDisposition'],
  defaultValue: 'inline' | 'attachment',
): string {
  return perCall ?? defaultValue
}

/**
 * Resolves the Cache-Control header from per-call → module default.
 *
 * @param perCall - The per-call Cache-Control, if any.
 * @param defaultValue - The module default.
 * @returns The resolved Cache-Control string.
 */
export function buildCacheControl(
  perCall: UploadOptions['cacheControl'],
  defaultValue: string,
): string {
  return perCall ?? defaultValue
}

/**
 * Resolves server-side-encryption headers. The per-call `'NONE'` sentinel is a
 * library-only token that forces no encryption header even when a module default
 * is configured; it is never forwarded to the SDK.
 *
 * @param perCall - The per-call SSE mode, or the `'NONE'` sentinel.
 * @param perCallKmsKeyId - The per-call KMS key id, if any.
 * @param module - The module SSE defaults.
 * @returns The SSE headers to merge into the command input (possibly empty).
 */
export function buildSSE(
  perCall: UploadOptions['serverSideEncryption'],
  perCallKmsKeyId: UploadOptions['kmsKeyId'],
  module: Pick<ResolvedBymaxStorageOptions, 'serverSideEncryption' | 'kmsKeyId'>,
): SseHeaders {
  if (perCall === 'NONE') {
    return {}
  }
  const sse = perCall ?? module.serverSideEncryption
  if (!sse) {
    return {}
  }
  if (sse === 'aws:kms') {
    const kmsKeyId = perCallKmsKeyId ?? module.kmsKeyId
    return kmsKeyId !== undefined
      ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId }
      : { ServerSideEncryption: 'aws:kms' }
  }
  return { ServerSideEncryption: sse }
}

/**
 * Resolves the canned ACL from per-call → module default.
 *
 * Note: `'public-read'` returns HTTP 400 `AccessControlListNotSupported` on
 * modern AWS S3 (ACLs disabled / Block Public Access) and is a silent no-op on
 * Cloudflare R2. Public delivery should normally go through `publicBaseUrl` /
 * `cdnBaseUrl`; the header is emitted only for buckets that explicitly allow ACLs.
 *
 * @param perCall - The per-call public-read flag, if any.
 * @param defaultValue - The module default.
 * @returns `'public-read'` when public access is requested, otherwise `undefined`.
 */
export function buildACL(
  perCall: UploadOptions['publicRead'],
  defaultValue: boolean,
): 'public-read' | undefined {
  return (perCall ?? defaultValue) ? 'public-read' : undefined
}
