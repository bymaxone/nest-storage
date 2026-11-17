/**
 * @fileoverview The per-call inputs that are checked for their kind before they are used: the target
 * bucket and the abort signal. A value of the wrong kind is refused with a typed error that names the
 * field and nothing of the value, before any request, so it can neither reach the SDK (which would put
 * it in its own error message) nor a log line.
 * @layer server/utils
 */
import { StorageException } from '../errors/storage-exception'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/** A validation error that names `field` and the kind of value it needs; the value itself is never read. */
function wrongKind(field: string, needs: string): StorageException {
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
    field,
    reason: `${field} must be ${needs}`,
  })
}

/**
 * Resolves the bucket a call targets: the per-call override when there is one, else the module default.
 *
 * @param perCall - The caller's `bucket`, whatever it is; `undefined` and `null` mean "not given".
 * @param moduleDefault - The module's configured bucket, possibly empty.
 * @returns The bucket name.
 * @throws StorageException `STORAGE_VALIDATION_FAILED` naming `bucket` when the override is not a string.
 * @throws StorageException `STORAGE_BUCKET_UNDEFINED` when no non-empty bucket is left.
 */
export function resolveBucket(perCall: unknown, moduleDefault: string): string {
  if (perCall !== undefined && perCall !== null && typeof perCall !== 'string') {
    throw wrongKind('bucket', 'a string')
  }
  const bucket = perCall ?? moduleDefault
  if (!bucket) {
    throw new StorageException(STORAGE_ERROR_CODES.STORAGE_BUCKET_UNDEFINED)
  }
  return bucket
}

/**
 * Throws unless `signal` is absent or has the surface of an `AbortSignal` (a boolean `aborted` and an
 * `addEventListener` function). Anything else would reach the SDK, which names the value in its message.
 *
 * @param signal - The caller's `abortSignal`, whatever it is; `undefined` and `null` mean "none".
 * @throws StorageException `STORAGE_VALIDATION_FAILED` naming `abortSignal`.
 */
export function assertAbortSignal(signal: unknown): void {
  if (signal === undefined || signal === null) return
  const candidate = signal as { aborted?: unknown; addEventListener?: unknown }
  if (
    typeof signal !== 'object' ||
    typeof candidate.aborted !== 'boolean' ||
    typeof candidate.addEventListener !== 'function'
  ) {
    throw wrongKind('abortSignal', 'an AbortSignal')
  }
}
