/**
 * @fileoverview Turns the failure of a size-guarded stream into the public `STORAGE_SIZE_EXCEEDED`
 * exception, whichever layer of the upload surfaced it.
 * @layer server/errors
 */
import { StorageException } from './storage-exception'
import { SizeLimitError, type SizeLimitKind } from '../utils/size-limit'
import { STORAGE_ERROR_CODES } from '../../shared/constants/error-codes.constants'

/**
 * Builds the `STORAGE_SIZE_EXCEEDED` exception for a bound that was crossed.
 *
 * @param limitBytes - The bound.
 * @param kind - Whether it is the configured maximum or the size the caller declared.
 * @param context - Details to carry (key, bucket and, for multipart, the abort outcome).
 * @returns The exception.
 */
export function sizeLimitException(
  limitBytes: number,
  kind: SizeLimitKind,
  context: Record<string, unknown>,
): StorageException {
  const bound = kind === 'declared' ? { declaredSize: limitBytes } : { maxSize: limitBytes }
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_SIZE_EXCEEDED, undefined, {
    ...context,
    ...bound,
  })
}

/**
 * @param err - Whatever the upload rejected with.
 * @param context - Details to carry (key, bucket and, for multipart, the abort outcome).
 * @returns The exception when `err` is a size-limit failure, otherwise `undefined`.
 */
export function mapSizeLimitError(
  err: unknown,
  context: Record<string, unknown>,
): StorageException | undefined {
  if (!(err instanceof SizeLimitError)) {
    return undefined
  }
  return sizeLimitException(err.limitBytes, err.kind, context)
}
