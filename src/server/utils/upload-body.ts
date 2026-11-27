/**
 * @fileoverview The size rules for an upload body: what a body is measured as, and the cap a
 * stream takes on the multipart path. Kept apart from the service so each rule is testable alone.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { withExactSize, withSizeLimit } from './size-limit'
import { withFields } from './read-once'
import { declaredSizeMismatch } from '../errors/size-limit-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import {
  destroyStream,
  isBufferLike,
  readStreamUpTo,
  toUploadBody,
  type UploadBody,
} from './stream-utils'
import { verdictOf } from './settle-or-cut'

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
  // A body that is not bytes is returned as it was given: `toUploadBody` hands back the same stream.
  return isBufferLike(body) ? withFields(options, { body, size: body.byteLength }) : options
}

/**
 * Caps a stream, as it is read: one with a declared size is held to exactly that size on either
 * upload path, so a source cut short is not stored as the whole and a longer one is refused before
 * its last byte is sent; one with no declared size cannot exceed the configured maximum.
 *
 * @param body - The body about to be uploaded.
 * @param declaredSize - The size the caller declared, if any.
 * @param options - The resolved module options: `validation.maxSizeBytes`.
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
  return declaredSize === undefined
    ? withSizeLimit(body, limit, 'max')
    : withExactSize(body, declaredSize)
}

/**
 * Reads a stream body into one `Buffer` so a pre-upload scan and the upload see the same bytes. A
 * stream with no bound is refused, and so is one longer than the bound; both release the stream.
 *
 * @param body - The stream body.
 * @param context - The caller's own identifiers, for the error details (see `callDetails`).
 * @param maxSizeBytes - `validation.maxSizeBytes`, the bound on the buffer.
 * @returns The buffered body.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` when there is no bound or the stream exceeds it.
 */
export async function bufferStreamForScan(
  body: NodeJS.ReadableStream,
  context: Record<string, unknown>,
  maxSizeBytes: number | undefined,
): Promise<Buffer> {
  if (maxSizeBytes === undefined) {
    destroyStream(body)
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      ...context,
      reason:
        'Pre-upload scanning of a stream needs validation.maxSizeBytes to bound the buffer; set it or use scanner mode post-upload',
    })
  }
  const buffered = await verdictOf(readStreamUpTo(body, maxSizeBytes))
  if (buffered === undefined) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      ...context,
      maxSizeBytes,
      reason:
        'The stream is longer than validation.maxSizeBytes, so it cannot be scanned before upload',
    })
  }
  return buffered
}

/**
 * Checks a body that was read into memory for a pre-upload scan against the size its caller declared,
 * as `boundStreamSize` does for a stream that is sent as it is read: a buffer of another length is
 * refused, since it is not the object the caller described.
 *
 * @param body - The body after the scan buffering.
 * @param declaredSize - The size the caller declared, if any.
 * @param context - Details to carry (key and bucket).
 * @throws StorageException `STORAGE_SIZE_EXCEEDED` or `STORAGE_VALIDATION_FAILED` on a mismatch.
 */
export function assertScannedSize(
  body: UploadBody,
  declaredSize: number | undefined,
  context: Record<string, unknown>,
): void {
  if (!isBufferLike(body) || declaredSize === undefined || body.byteLength === declaredSize) {
    return
  }
  throw declaredSizeMismatch(declaredSize, body.byteLength, context)
}
