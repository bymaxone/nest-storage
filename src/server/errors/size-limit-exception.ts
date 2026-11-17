/**
 * @fileoverview Turns the failure of a size-guarded stream into the public `STORAGE_SIZE_EXCEEDED`
 * exception, whichever layer of the upload surfaced it.
 * @layer server/errors
 */
import { StorageException } from './storage-exception'
import { SizeLimitError, SizeShortfallError, type SizeLimitKind } from '../utils/size-limit'
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
 * @returns The exception when `err` is a size-limit or size-shortfall failure, otherwise `undefined`.
 */
export function mapSizeLimitError(
  err: unknown,
  context: Record<string, unknown>,
): StorageException | undefined {
  if (err instanceof SizeShortfallError) {
    return declaredSizeMismatch(err.declaredBytes, err.receivedBytes, context)
  }
  if (!(err instanceof SizeLimitError)) {
    return undefined
  }
  return sizeLimitException(err.limitBytes, err.kind, context)
}

/** The details of the refusal for a body shorter than the size its caller declared. */
function shortfallDetails(declaredBytes: number, receivedBytes: number): Record<string, unknown> {
  return {
    field: 'size',
    reason: 'The body is shorter than the declared size',
    declaredSize: declaredBytes,
    receivedSize: receivedBytes,
  }
}

/**
 * The refusal for a body whose length is not the size its caller declared: longer is
 * `STORAGE_SIZE_EXCEEDED`, shorter `STORAGE_VALIDATION_FAILED` naming `size`.
 *
 * @param declaredBytes - The size the caller declared.
 * @param receivedBytes - The length the body turned out to have.
 * @param context - Details to carry (key and bucket).
 * @returns The exception to throw.
 */
export function declaredSizeMismatch(
  declaredBytes: number,
  receivedBytes: number,
  context: Record<string, unknown>,
): StorageException {
  // Stryker disable next-line EqualityOperator: both callers pass lengths that differ, so the two arms never meet at equality and `>=` gives the same answer (equivalent).
  if (receivedBytes > declaredBytes) {
    return sizeLimitException(declaredBytes, 'declared', context)
  }
  return new StorageException(STORAGE_ERROR_CODES.STORAGE_VALIDATION_FAILED, undefined, {
    ...context,
    ...shortfallDetails(declaredBytes, receivedBytes),
  })
}
