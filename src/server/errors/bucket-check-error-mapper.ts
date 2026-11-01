/**
 * @fileoverview Maps a failed `HeadBucket` probe to the typed code that says what is wrong with
 * the bucket. A `HEAD` response carries no body, so the status code is all there is to go on.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { mapAwsError } from './aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

interface HeadBucketFailure {
  name?: string
  $metadata?: { httpStatusCode?: number }
}

/**
 * @param err - What the SDK rejected `HeadBucket` with.
 * @param context - Non-sensitive context merged into `details`.
 * @returns `STORAGE_BUCKET_NOT_FOUND` for a 404, `STORAGE_BUCKET_ACCESS_DENIED` for a 403 (the
 *   provider answers 403 for a bucket the caller cannot list, so it can also mean "missing"),
 *   `STORAGE_BUCKET_REGION_MISMATCH` for a 301 or `PermanentRedirect`, otherwise what
 *   {@link mapAwsError} makes of it (`NoSuchBucket` is `STORAGE_BUCKET_NOT_FOUND` there, and a
 *   timeout stays `STORAGE_TIMEOUT`).
 */
export function mapBucketCheckError(
  err: unknown,
  context: Record<string, unknown>,
): StorageException {
  const failure = (err ?? {}) as HeadBucketFailure
  const status = failure.$metadata?.httpStatusCode
  const details = { ...context, httpStatus: status, awsCode: failure.name }
  if (status === 301 || failure.name === 'PermanentRedirect') {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_BUCKET_REGION_MISMATCH,
      undefined,
      details,
    )
  }
  if (status === 403) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_BUCKET_ACCESS_DENIED,
      undefined,
      details,
    )
  }
  if (status === 404) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_BUCKET_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      details,
    )
  }
  return mapAwsError(err, context)
}
