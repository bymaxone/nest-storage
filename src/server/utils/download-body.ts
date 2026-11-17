/**
 * @fileoverview The idle guard for a download body: a body that stops delivering bytes fails the
 * caller's read with `STORAGE_TIMEOUT` and releases the connection, while one the caller is merely
 * slow to read is left alone.
 * @layer server/utils
 */
import { mapAwsError } from '../errors/aws-error-mapper'
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'
import { requestAborted } from './abort-support'
import { SourceIdleError, withIdleTimeout } from './idle-timeout'

/**
 * Wraps a download body so silence of `idleMs` while a read is pending fails it with
 * `STORAGE_TIMEOUT` (`details.phase: 'body-idle'`). The clock never runs while the caller is not
 * reading, so backpressure from a slow consumer is not a stall.
 *
 * @param body - The body the SDK returned.
 * @param idleMs - Longest silence allowed; `0` returns `body` unchanged.
 * @param context - Non-sensitive details to carry on the error (key, bucket).
 * @param signal - The caller's `abortSignal`: a body that ends because it aborted ends as the typed abort error.
 * @returns The guarded stream, or `body` when the guard is off: the SDK's own stream, which errors with
 *   the SDK's own error.
 */
export function guardDownloadBody(
  body: NodeJS.ReadableStream,
  idleMs: number,
  context: Record<string, unknown>,
  signal?: AbortSignal,
): NodeJS.ReadableStream {
  if (idleMs === 0) {
    return body
  }
  return withIdleTimeout(body, idleMs, (error) => {
    if (error instanceof SourceIdleError) {
      return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, undefined, {
        ...context,
        phase: 'body-idle',
        idleMs: error.idleMs,
      })
    }
    // The SDK ends a body it is reading with an AbortError when the caller's signal aborts; any
    // other failure of the body (a reset connection) is mapped as one of the request itself.
    return signal?.aborted ? requestAborted(signal, context) : mapAwsError(error, context)
  })
}

/**
 * The failure a caller gets when reading a download body fails: the typed abort when its signal
 * aborted, a `StorageException` as it is, and anything else (the SDK's own error, when the idle guard
 * is off) mapped as a failure of the provider.
 *
 * @param err - What reading the body threw.
 * @param signal - The caller's `abortSignal`.
 * @param context - Non-sensitive details to carry on the error (key, bucket, op).
 * @returns The error to throw.
 */
export function mapBodyReadFailure(
  err: unknown,
  signal: AbortSignal | undefined,
  context: Record<string, unknown>,
): unknown {
  if (err instanceof StorageException) {
    return err
  }
  // The signal is read first: mapping logs the failure, and a request the caller cancelled is not one.
  return signal?.aborted ? requestAborted(signal, context) : mapAwsError(err, context)
}
