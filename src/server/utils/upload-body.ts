/**
 * @fileoverview The size rules for an upload body: what a body is measured as, and the cap a
 * stream takes on the multipart path. Kept apart from the service so each rule is testable alone.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { withExactSize, withSizeLimit } from './size-limit'
import { pickUploadStrategy } from './upload-strategy'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import {
  destroyStream,
  isBufferLike,
  readStreamUpTo,
  toUploadBody,
  type UploadBody,
} from './stream-utils'

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
 * Caps a stream, as it is read, at the lower of the configured maximum and the size its caller
 * declared, so an undeclared stream or one longer than it declared cannot exceed either. A
 * single-shot stream must have exactly the size declared: the request carries `Content-Length` set
 * to that size, and a longer body would leave the provider with an object of the declared length
 * and the rest unread, which it stores as if it were the whole.
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
  if (isBufferLike(body) || limit === undefined) {
    return body
  }
  const singleShot =
    pickUploadStrategy(body, declaredSize, options.multipart.thresholdBytes) === 'single-shot'
  if (declaredSize !== undefined && singleShot) {
    return withExactSize(body, declaredSize)
  }
  return withSizeLimit(body, limit, declaredSize === undefined ? 'max' : 'declared')
}

/**
 * Reads a stream body into one `Buffer` so a pre-upload scan and the upload see the same bytes. A
 * stream with no bound is refused, and so is one longer than the bound; both release the stream.
 *
 * @param body - The stream body.
 * @param finalKey - The resolved key, for the error details.
 * @param maxSizeBytes - `validation.maxSizeBytes`, the bound on the buffer.
 * @returns The buffered body.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when there is no bound or the stream exceeds it.
 */
export async function bufferStreamForScan(
  body: NodeJS.ReadableStream,
  finalKey: string,
  maxSizeBytes: number | undefined,
): Promise<Buffer> {
  if (maxSizeBytes === undefined) {
    destroyStream(body)
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      key: finalKey,
      reason:
        'Pre-upload scanning of a stream needs validation.maxSizeBytes to bound the buffer; set it or use scanner mode post-upload',
    })
  }
  const buffered = await readStreamUpTo(body, maxSizeBytes)
  if (buffered === undefined) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      key: finalKey,
      maxSizeBytes,
      reason:
        'The stream is longer than validation.maxSizeBytes, so it cannot be scanned before upload',
    })
  }
  return buffered
}
