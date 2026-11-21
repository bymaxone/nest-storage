/**
 * @fileoverview The error for an object a post-upload scan rejected: the scanner's verdict stays the
 * error, and when the object could not be removed it says so.
 * @layer server/errors
 */
import { HttpStatus } from '@nestjs/common'
import { StorageException } from './storage-exception'
import { projectProviderFailure } from '../utils/provider-failure-log'

/** The status of `error` when it is one of the `HttpStatus` values, else `undefined` (the code's own). */
function knownStatus(error: StorageException): HttpStatus | undefined {
  // A numeric enum maps each value back to its name; a number outside the enum has none.
  const name = HttpStatus[error.getStatus()] as keyof typeof HttpStatus | undefined
  return name === undefined ? undefined : HttpStatus[name]
}

/**
 * What a client reads of a failed delete: the code of a `StorageException`, or a fixed word for any
 * other failure. Never the text of the driver or of the provider, which is for the logs
 * ({@link describeCleanupFailure}).
 */
function cleanupErrorCode(error: unknown): string {
  return error instanceof StorageException ? error.code : 'UNKNOWN'
}

/**
 * Describes why a delete failed, for a log line: a `StorageException`'s own `message` is the generic
 * 'Storage Exception', so its code is used; what the provider said was logged when the call was mapped.
 * Anything else is described as the provider's own errors are in the log: secrets masked, the length
 * bounded and control characters escaped.
 *
 * @param error - What the delete threw.
 * @returns The text for the log.
 */
export function describeCleanupFailure(error: unknown): string {
  if (!(error instanceof StorageException)) {
    return projectProviderFailure(error).message
  }
  return error.code
}

/**
 * @param scanError - What the scan rejected with (a `StorageException` carrying the verdict).
 * @param keys - The object that should have been removed: `key` is the key the caller passed. The key
 *   as the provider holds it (with any `keyPrefix`) is the host's configuration and is not carried here.
 * @param cleanupError - Why the delete failed.
 * @returns The same verdict (code, and status when it is an `HttpStatus` value) with `cleanup: 'failed'`, the key and the delete
 *   failure added to its details, so a caller can tell "rejected and removed" from "rejected but
 *   still stored". Anything that is not a `StorageException` is returned unchanged.
 */
export function withCleanupFailure(
  scanError: unknown,
  keys: { key: string },
  cleanupError: unknown,
): unknown {
  if (!(scanError instanceof StorageException)) {
    return scanError
  }
  const body = scanError.getResponse() as { error?: { details?: Record<string, unknown> } }
  return new StorageException(
    scanError.code,
    knownStatus(scanError),
    {
      ...(body.error?.details ?? {}),
      key: keys.key,
      cleanup: 'failed',
      cleanupError: cleanupErrorCode(cleanupError),
    },
  )
}
