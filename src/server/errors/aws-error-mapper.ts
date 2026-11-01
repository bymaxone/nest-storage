/**
 * @fileoverview Maps AWS SDK errors to `StorageException`, preserving the AWS
 * error code, HTTP status, and request id in `details` for observability.
 * Credentials and signed URLs are never placed in `details`.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

interface AwsLikeError {
  name?: string
  $metadata?: { httpStatusCode?: number; requestId?: string }
  message?: string
  Code?: string
}

/**
 * Maps an AWS SDK error to a typed `StorageException`.
 *
 * Heuristics:
 *   - `NoSuchBucket` → `STORAGE_BUCKET_NOT_FOUND` (404)
 *   - `name === 'NotFound'` or HTTP 404 → `STORAGE_OBJECT_NOT_FOUND` (404)
 *   - HTTP 304 (`If-None-Match` matched) → `STORAGE_NOT_MODIFIED` (304)
 *   - HTTP 412 (`If-Match` failed)       → `STORAGE_PRECONDITION_FAILED` (412)
 *   - `name === 'TimeoutError'`          → `STORAGE_TIMEOUT` (504)
 *   - anything else                      → `STORAGE_PROVIDER_ERROR` (502)
 *
 * @param err - The error thrown by the AWS SDK (typed as `unknown`).
 * @param context - Optional non-sensitive context merged into `details`.
 * @returns A typed `StorageException` carrying observability metadata.
 */
export function mapAwsError(err: unknown, context?: Record<string, unknown>): StorageException {
  const e = (err ?? {}) as AwsLikeError
  const httpStatus = e.$metadata?.httpStatusCode
  const awsCode = e.Code ?? e.name
  const requestId = e.$metadata?.requestId
  const details: Record<string, unknown> = {
    ...(context ?? {}),
    awsCode,
    httpStatus,
    requestId,
    awsMessage: e.message,
  }

  if (awsCode === 'NoSuchBucket') {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_BUCKET_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      details,
    )
  }
  if (e.name === 'NotFound' || httpStatus === 404) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      details,
    )
  }
  if (httpStatus === 304) {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_NOT_MODIFIED, HttpStatus.NOT_MODIFIED, details)
  }
  if (httpStatus === 412) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
      HttpStatus.PRECONDITION_FAILED,
      details,
    )
  }
  if (e.name === 'TimeoutError') {
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT, details)
  }
  return new StorageException(
    STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR,
    HttpStatus.BAD_GATEWAY,
    details,
  )
}
