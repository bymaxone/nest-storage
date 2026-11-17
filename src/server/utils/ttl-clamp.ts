/**
 * @fileoverview Pure TTL validation and clamping utility for presigned URLs.
 * The SigV4 hard ceiling is 604800 s (7 days) — values above it are silently
 * clamped (consumer-friendly, parity with the SDK's own behaviour). Non-positive
 * values are rejected with a typed error because they would produce an immediately
 * invalid signature.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * Resolves the effective presign TTL in seconds.
 *
 * - `ttlSeconds` is `undefined` → returns `defaultTtl`.
 * - `ttlSeconds > maxTtl` → silently clamps to `maxTtl` (consumer-friendly;
 *   the SDK's `getSignedUrl` does the same for its own ceiling).
 * - `ttlSeconds` not a whole number above 0 (`NaN`, a fraction, a string, zero or less) → throws
 *   `STORAGE_SIGNED_URL_TTL_INVALID`: `NaN` would put `X-Amz-Expires=NaN` in the URL, and a
 *   non-positive TTL would produce a URL that is immediately expired or cryptographically undefined.
 *
 * The SigV4 presign hard ceiling is **604800 s (7 days)**. Callers should
 * clamp `maxTtl` to that value before passing it here.
 *
 * @param ttlSeconds - The caller-requested TTL, or `undefined` to use the default.
 * @param defaultTtl - The module-configured default TTL.
 * @param maxTtl - The maximum allowed TTL; values above this are silently clamped.
 * @returns The effective TTL in seconds.
 * @throws StorageException `STORAGE_SIGNED_URL_TTL_INVALID` when the TTL is not a whole number above 0.
 */
export function clampTtl(
  ttlSeconds: number | undefined,
  defaultTtl: number,
  maxTtl: number,
): number {
  const ttl = ttlSeconds ?? defaultTtl
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_SIGNED_URL_TTL_INVALID, undefined, {
      reason: Number.isFinite(ttl) && ttl <= 0 ? 'TTL must be > 0' : 'TTL must be a whole number of seconds greater than 0',
      provided: ttl,
    })
  }
  return Math.min(ttl, maxTtl)
}
