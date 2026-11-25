/**
 * @fileoverview Maps AWS SDK errors to `StorageException`, preserving the AWS
 * error code, HTTP status, and request id in `details` for observability.
 * Credentials and signed URLs are never placed in `details`.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { isRootRefusal } from '../utils/prototype-guard'
import { logProviderFailure } from '../utils/provider-failure-log'
import { providerFailureReason, providerFailureStatus } from './provider-failure'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

interface AwsLikeError {
  name?: string
  $metadata?: { httpStatusCode?: number; requestId?: string }
  message?: string
  Code?: string
}

/** The provider's code for a failure, or the error's name when it sent none. */
function awsCodeOf(err: unknown): unknown {
  const e = (err ?? {}) as AwsLikeError
  return e.Code ?? e.name
}

/**
 * Whether the provider said the bucket does not exist.
 *
 * @param err - The error thrown by the AWS SDK (typed as `unknown`).
 * @returns `true` for `NoSuchBucket`.
 */
export function isNoSuchBucket(err: unknown): boolean {
  return awsCodeOf(err) === 'NoSuchBucket'
}

/**
 * Maps the answers a caller treats as an outcome and not a failure: a missing object, a conditional
 * GET that matched, a precondition that failed.
 *
 * @param e - The error thrown by the AWS SDK.
 * @param details - The details every mapped error carries.
 * @returns The typed exception, or `undefined` when the answer is none of these.
 */
function mapAnsweredStatus(
  e: AwsLikeError,
  details: Record<string, unknown>,
): StorageException | undefined {
  const status = e.$metadata?.httpStatusCode
  if (e.name === 'NotFound' || status === 404) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_OBJECT_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      details,
    )
  }
  if (status === 304) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_NOT_MODIFIED,
      HttpStatus.NOT_MODIFIED,
      details,
    )
  }
  if (status === 412) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
      HttpStatus.PRECONDITION_FAILED,
      details,
    )
  }
  return undefined
}

/**
 * Maps an AWS SDK error to a typed `StorageException`.
 *
 * Heuristics:
 *   - `NoSuchBucket` → `STORAGE_BUCKET_NOT_FOUND` (404)
 *   - `name === 'NotFound'` or HTTP 404 → `STORAGE_OBJECT_NOT_FOUND` (404)
 *   - HTTP 304 (`If-None-Match` matched) → `STORAGE_NOT_MODIFIED` (304)
 *   - HTTP 412 (`If-Match` failed)       → `STORAGE_PRECONDITION_FAILED` (412)
 *   - `name === 'TimeoutError'`          → `STORAGE_TIMEOUT` (503)
 *   - unreachable or a server error      → `STORAGE_PROVIDER_ERROR` (503)
 *   - credentials refused (403)          → `STORAGE_PROVIDER_ERROR` (500)
 *   - anything else                      → `STORAGE_PROVIDER_ERROR` (502)
 *
 * @param err - The error thrown by the AWS SDK (typed as `unknown`).
 * @param context - Optional non-sensitive context merged into `details`.
 * @returns A typed `StorageException` carrying observability metadata.
 */
export function mapAwsError(err: unknown, context?: Record<string, unknown>): StorageException {
  // The library's own refusal (raised inside a send) keeps its code and status.
  if (isRootRefusal(err)) return err as StorageException
  const e = (err ?? {}) as AwsLikeError
  const httpStatus = e.$metadata?.httpStatusCode
  const awsCode = awsCodeOf(err)
  const requestId = e.$metadata?.requestId
  const details: Record<string, unknown> = {
    ...(context ?? {}),
    awsCode,
    httpStatus,
    requestId,
    // A fixed word, never what the driver or the provider wrote.
    reason: providerFailureReason(err),
  }

  if (isNoSuchBucket(err)) {
    return new StorageException(
      STORAGE_ERROR_CODES.STORAGE_BUCKET_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      details,
    )
  }
  const answered = mapAnsweredStatus(e, details)
  if (answered) return answered
  if (e.name === 'TimeoutError') {
    logProviderFailure(err, context)
    return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, undefined, details)
  }
  logProviderFailure(err, context)
  return new StorageException(
    STORAGE_ERROR_CODES.STORAGE_PROVIDER_ERROR,
    providerFailureStatus(err),
    details,
  )
}
