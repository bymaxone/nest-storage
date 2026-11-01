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
 * Describes why a delete failed. A `StorageException`'s own `message` is the generic
 * 'Storage Exception', so its code and the provider's message (kept in its details) are used.
 */
function describeCleanupError(error: unknown): string {
  if (!(error instanceof StorageException)) {
    return describeError(error)
  }
  const body = error.getResponse() as { error?: { details?: { awsMessage?: unknown } } }
  const awsMessage = body.error?.details?.awsMessage
  return typeof awsMessage === 'string' ? `${error.code}: ${awsMessage}` : error.code
}

/**
 * @param scanError - What the scan rejected with (a `StorageException` carrying the verdict).
 * @param keys - The object that should have been removed: `key` is the caller's relative key and
 *   `storedKey` the key as the provider holds it (with any `keyPrefix`), which is what a bucket
 *   listing shows.
 * @param cleanupError - Why the delete failed.
 * @returns The same verdict (code, and status when it is an `HttpStatus` value) with `cleanup: 'failed'`, both keys and the delete
 *   failure added to its details, so a caller can tell "rejected and removed" from "rejected but
 *   still stored". Anything that is not a `StorageException` is returned unchanged.
 */
export function withCleanupFailure(
  scanError: unknown,
  keys: { key: string; storedKey: string },
  cleanupError: unknown,
): unknown {
  if (!(scanError instanceof StorageException)) {
    return scanError
  }
  const body = scanError.getResponse() as { error?: { details?: Record<string, unknown> } }
  return new StorageException(scanError.code, knownStatus(scanError), {
    ...(body.error?.details ?? {}),
    key: keys.key,
    storedKey: keys.storedKey,
    cleanup: 'failed',
    cleanupError: describeCleanupError(cleanupError),
  })
}
