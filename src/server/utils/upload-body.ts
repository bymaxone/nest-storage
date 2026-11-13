/**
 * @fileoverview The size rules for an upload body: what a body is measured as, and the cap a
 * stream takes on the multipart path. Kept apart from the service so each rule is testable alone.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { withSizeLimit } from './size-limit'
import { isBufferLike, toUploadBody, type UploadBody } from './stream-utils'
import { pickUploadStrategy } from './upload-strategy'

/**
 * Brings an untyped body to bytes: a string becomes its UTF-8 bytes and an `ArrayBuffer` or other
 * view becomes a `Buffer`. A buffer has one size, its own length, which replaces any size the
 * caller declared, so the limit check, the strategy, `Content-Length` and the result agree.
 *
 * @param options - The upload request as the caller passed it.
 * @returns The request with its body in an accepted shape and a buffer's size set to its length.
 */
export function withBytesBody(options: UploadOptions): UploadOptions {
  const body = toUploadBody(options.body)
  return isBufferLike(body) ? { ...options, body, size: body.byteLength } : { ...options, body }
}

/**
 * Caps a stream that takes the multipart path, as it is read, at the lower of the configured
 * maximum and the size its caller declared, so an undeclared stream or one longer than it declared
 * cannot exceed either. A single-shot stream needs no cap: the request carries `Content-Length`
 * set to the declared size.
 *
 * @param body - The body about to be uploaded.
 * @param declaredSize - The size the caller declared, if any.
 * @param options - The resolved module options: `validation.maxSizeBytes` and the multipart threshold.
 * @returns `body`, or a guarded stream that fails once the cap is crossed.
 */
export function boundStreamSize(
  body: UploadBody,
  declaredSize: number | undefined,
  options: ResolvedBymaxStorageOptions,
): UploadBody {
  // A declared size above the maximum is refused before this point, so it is the lower bound.
  const limit = declaredSize ?? options.validation?.maxSizeBytes
  const singleShot =
    pickUploadStrategy(body, declaredSize, options.multipart.thresholdBytes) === 'single-shot'
  if (isBufferLike(body) || singleShot || limit === undefined) {
    return body
  }
  return withSizeLimit(body, limit, declaredSize === undefined ? 'max' : 'declared')
}
