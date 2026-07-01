/**
 * @fileoverview Pure decision for how an upload is dispatched: a single-shot
 * `PutObject` or a multipart upload. The choice depends on the body shape, the
 * declared size, and the configured multipart threshold.
 * @layer server/utils
 */
import { getBodySize, isReadable, type UploadBody } from './stream-utils'

/** The two dispatch paths an upload can take. */
export type UploadStrategy = 'single-shot' | 'multipart'

/**
 * Picks the upload strategy.
 *
 * Decision table:
 *   - a stream of unknown length                     → `'multipart'`
 *   - a known size at or above `thresholdBytes`       → `'multipart'`
 *   - everything else (small buffers/known streams)   → `'single-shot'`
 *
 * @param body - The polymorphic upload body.
 * @param declaredSize - The caller-declared size, if any.
 * @param thresholdBytes - The size at/above which multipart is used.
 * @returns The chosen strategy.
 */
export function pickUploadStrategy(
  body: UploadBody,
  declaredSize: number | undefined,
  thresholdBytes: number,
): UploadStrategy {
  const size = declaredSize ?? getBodySize(body)

  if (isReadable(body) && size === undefined) {
    return 'multipart'
  }
  if (size !== undefined && size >= thresholdBytes) {
    return 'multipart'
  }
  return 'single-shot'
}
