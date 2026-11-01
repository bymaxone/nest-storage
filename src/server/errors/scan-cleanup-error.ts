/**
 * @fileoverview The error for an object a post-upload scan rejected: the scanner's verdict stays the
 * error, and when the object could not be removed it says so.
 * @layer server/errors
 */
import { StorageException } from './storage-exception'
import { describeError } from '../utils/describe-error'

/**
 * @param scanError - What the scan rejected with (a `StorageException` carrying the verdict).
 * @param key - The relative key of the object that should have been removed.
 * @param cleanupError - Why the delete failed.
 * @returns The same verdict (code and status) with `cleanup: 'failed'`, the key and the delete
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
  return new StorageException(scanError.code, undefined, {
    ...(body.error?.details ?? {}),
    key,
    cleanup: 'failed',
    cleanupError: describeError(cleanupError),
  })
}
