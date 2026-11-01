/**
 * @fileoverview The error for an object a post-upload scan rejected: the scanner's verdict stays the
 * error, and when the object could not be removed it says so.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { describeError } from '../utils/describe-error'

/** The status of `error` when it is one of the `HttpStatus` values, else `undefined` (the code's own). */
function knownStatus(error: StorageException): HttpStatus | undefined {
  // A numeric enum maps each value back to its name; a number outside the enum has none.
  const name = HttpStatus[error.getStatus()] as keyof typeof HttpStatus | undefined
  return name === undefined ? undefined : HttpStatus[name]
}

/**
 * @param scanError - What the scan rejected with (a `StorageException` carrying the verdict).
 * @param key - The relative key of the object that should have been removed.
 * @param cleanupError - Why the delete failed.
 * @returns The same verdict (code, and status when it is an `HttpStatus` value) with `cleanup: 'failed'`, the key and the delete
 *   failure added to its details, so a caller can tell "rejected and removed" from "rejected but
 *   still stored". Anything that is not a `StorageException` is returned unchanged.
 */
export function withCleanupFailure(
  scanError: unknown,
  key: string,
  cleanupError: unknown,
): unknown {
  if (!(scanError instanceof StorageException)) {
    return scanError
  }
  const body = scanError.getResponse() as { error?: { details?: Record<string, unknown> } }
  return new StorageException(scanError.code, knownStatus(scanError), {
    ...(body.error?.details ?? {}),
    key,
    cleanup: 'failed',
    cleanupError: describeError(cleanupError),
  })
}
