/**
 * @fileoverview Maps a failed multipart upload to its `StorageException`: a source that went
 * silent is a timeout, anything else is an aborted multipart upload.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { describeError } from '../utils/describe-error'
import { SourceIdleError } from '../utils/idle-timeout'
import { mapAwsError } from './aws-error-mapper'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * @param err - What the uploader rejected with.
 * @param context - Non-sensitive context merged into `details`.
 * @returns `STORAGE_TIMEOUT` (504, `phase: 'source-idle'`) for an idle source,
 *   `STORAGE_BUCKET_NOT_FOUND` when the provider answered `NoSuchBucket`, else
 *   `STORAGE_MULTIPART_ABORTED`.
 */
export function mapMultipartError(
  err: unknown,
  context: Record<string, unknown>,
): StorageException {
  if (err instanceof SourceIdleError) {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT, {
      ...context,
      phase: 'source-idle',
      idleMs: err.idleMs,
    })
  }
  const bucketMissing = mapAwsError(err, context)
  if (bucketMissing.code === STORAGE_ERROR_CODES.STORAGE_BUCKET_NOT_FOUND) {
    return bucketMissing
  }
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_MULTIPART_ABORTED, undefined, {
    ...context,
    awsMessage: describeError(err),
  })
}
