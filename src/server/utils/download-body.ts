/**
 * @fileoverview The idle guard for a download body: a body that stops delivering bytes fails the
 * caller's read with `STORAGE_TIMEOUT` and releases the connection, while one the caller is merely
 * slow to read is left alone.
 * @layer server/utils
 */
import { HttpStatus } from '@nestjs/common'
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
 * @returns The guarded stream, or `body` when the guard is off.
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
      return new StorageException(STORAGE_ERROR_CODES.STORAGE_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT, {
        ...context,
        phase: 'body-idle',
        idleMs: error.idleMs,
      })
    }
    // The SDK ends a body it is reading with an AbortError when the caller's signal aborts.
    return signal?.aborted ? requestAborted(signal, context) : error
  })
}
