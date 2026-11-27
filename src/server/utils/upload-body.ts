/**
 * @fileoverview The size rules for an upload body: what a body is measured as, and the cap a
 * stream takes on the multipart path. Kept apart from the service so each rule is testable alone.
 * @layer server/utils
 */
import type { ResolvedBymaxStorageOptions } from '../config/resolved-options'
import type { UploadOptions } from '../interfaces/upload-options.interface'
import { SourceIdleError } from './idle-timeout'
import { withExactSize, withSizeLimit } from './size-limit'
import { pickUploadStrategy } from './upload-strategy'
import { withFields } from './read-once'
import { isRootRefusal } from './prototype-guard'
import { declaredSizeMismatch, sizeLimitException } from '../errors/size-limit-exception'
import { mapAwsError } from '../errors/aws-error-mapper'
import { mapMultipartError } from '../errors/multipart-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { StorageException } from '../errors/storage-exception'
import {
  asReadable,
  destroyStream,
  holdSource,
  isBufferLike,
  readStreamUpTo,
  toUploadBody,
  type UploadBody,
} from './stream-utils'
import { verdictOf } from './settle-or-cut'

/**
 * Brings an untyped body to bytes: a string becomes its UTF-8 bytes and an `ArrayBuffer` or other
 * view becomes a `Buffer`. A buffer has one size, its own length, which replaces any size the
 * caller declared, so the limit check, the strategy, `Content-Length` and the result agree. A
 * stream is taken hold of here, before anything is awaited (see `asReadable` and `holdSource`).
 *
 * @param options - The upload request as the caller passed it.
 * @returns The request with its body in an accepted shape and a buffer's size set to its length.
 */
export function withBytesBody(options: UploadOptions): UploadOptions {
  const body = toUploadBody(options.body)
  if (isBufferLike(body)) {
    return withFields(options, { body, size: body.byteLength })
  }
  // A live stream with a `destroyed` flag is returned as it was given, and so is the request.
  const held = holdSource(asReadable(body))
  return held === options.body ? options : withFields(options, { body: held })
}

/**
 * Caps a stream, as it is read, at the lower of the configured maximum and the size its caller
 * declared, so an undeclared stream or one longer than it declared cannot exceed either. A stream
 * with a declared size must also reach it, or a source cut short would be stored as the whole. For a
 * single-shot stream the exactness is held before the last byte is sent: the request carries `Content-Length` set
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

/** What `upload()` rejects with when the stream failed, or fell silent, while a scan read it. */
function scanReadFailure(
  err: unknown,
  strategy: ReturnType<typeof pickUploadStrategy>,
  context: Record<string, unknown>,
): StorageException {
  const op = strategy === 'multipart' ? 'upload-multipart' : 'upload-single'
  // The single request reports the abort of its send, not what the stream raised.
  return strategy === 'multipart' || err instanceof SourceIdleError
    ? mapMultipartError(err, { ...context, op })
    : mapAwsError(new DOMException(undefined, 'AbortError'), { ...context, op })
}

/**
 * Reads a stream body into one `Buffer` so a pre-upload scan and the upload see the same bytes. A
 * stream with no bound is refused, and so is one longer than the bound; both release the stream.
 * A stream that fails while it is read is reported as the upload that would have sent it reports it.
 *
 * @param body - The stream body.
 * @param context - The caller's own identifiers, for the error details (see `callDetails`).
 * @param declaredSize - The size the caller declared, if any.
 * @param options - The resolved module options: `validation.maxSizeBytes` and the multipart threshold.
 * @returns The buffered body.
 * @throws StorageException `STORAGE_SIZE_EXCEEDED` when the stream is longer than its declared size;
 *   `STORAGE_VALIDATION_FAILED` when there is no bound or an undeclared stream exceeds it; `STORAGE_PROVIDER_ERROR` or `STORAGE_MULTIPART_ABORTED` when the stream fails.
 */
export async function bufferStreamForScan(
  body: NodeJS.ReadableStream,
  context: Record<string, unknown>,
  declaredSize: number | undefined,
  options: ResolvedBymaxStorageOptions,
): Promise<Buffer> {
  const maxSizeBytes = options.validation?.maxSizeBytes
  if (maxSizeBytes === undefined) {
    destroyStream(body)
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
      ...context,
      reason:
        'Pre-upload scanning of a stream needs validation.maxSizeBytes to bound the buffer; set it or use scanner mode post-upload',
    })
  }
  // Read before the first byte: the strategy is the one the caller's stream would have been sent with.
  const strategy = pickUploadStrategy(body, declaredSize, options.multipart.thresholdBytes)
  let buffered: Buffer | undefined
  try {
    // A declared size above the maximum is refused before this point, so it is the lower bound.
    // No request is in flight while the stream is read here, so a silent source is given up by this clock.
    const ms = options.uploadIdleTimeoutMs
    const idle = { ms, error: new SourceIdleError(ms) }
    buffered = await verdictOf(readStreamUpTo(body, declaredSize ?? maxSizeBytes, idle))
  } catch (err) {
    // A refusal of the runtime check is not a failure of the stream: it keeps its own code.
    if (isRootRefusal(err)) {
      throw err
    }
    throw scanReadFailure(err, strategy, context)
  }
  if (buffered === undefined) {
    // Refused at the first byte over, as the send refuses it, whatever the stream would do next.
    if (declaredSize !== undefined) {
      throw sizeLimitException(declaredSize, 'declared', context)
    }
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
